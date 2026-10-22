package com.plotlineai.backend.dataset;

import com.plotlineai.backend.dataset.dto.ColumnSchema;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;

/**
 * Runs every CSV under {@code -Dcorpus.dir} through the upload's parse and inference, with the
 * production caps, and writes a Markdown report to {@code -Dcorpus.report}. It measures how
 * real-world files fare; it asserts nothing and is skipped in normal builds.
 *
 * <pre>./mvnw test -Dtest=CorpusReportTest -Dcorpus.dir=... -Dcorpus.report=...</pre>
 */
@EnabledIfSystemProperty(named = "corpus.dir", matches = ".+")
class CorpusReportTest {

    private static final DatasetCapsProperties CAPS =
        new DatasetCapsProperties(5_242_880L, 100_000, 256, 32_768, Duration.ofHours(24), 20, 300);

    /** Loosely numeric once currency, grouping, percent, parentheses and a unit are set aside. */
    private static final Pattern LOOSE_NUMBER = Pattern.compile(
        "^[(+-]?[$€£¥]?\\s?[0-9][0-9.,' ]*(?:[eE][+-]?[0-9]+)?\\)?\\s?(?:%|[A-Za-z°/]{1,8})?$");
    private static final Pattern LOOSE_DATE = Pattern.compile(
        "^(?:[0-9]{1,4}[-/.][0-9A-Za-z]{1,9}(?:[-/.][0-9]{1,4})?"
            + "|[A-Za-z]{3,9}\\.? [0-9]{1,2},? [0-9]{4}|[A-Za-z]{3,9} [0-9]{4})"
            + "(?:[ T][0-9]{1,2}:[0-9]{2}(?::[0-9]{2}(?:\\.[0-9]+)?)?\\s?(?:[AaPp][Mm]|Z|[+-][0-9:]{2,5})?)?$");
    private static final double SUSPECT_SHARE = 0.9;

    private record Suspect(String file, String column, String kind, double share, List<String> examples) {
    }

    @Test
    void report() throws IOException {
        Path dir = Path.of(System.getProperty("corpus.dir"));
        Path out = Path.of(System.getProperty("corpus.report", dir.resolve("report.md").toString()));
        CsvParser parser = new CsvParser(CAPS);
        SchemaInferrer inferrer = new SchemaInferrer();

        Map<String, List<String>> failures = new TreeMap<>();
        Map<ColumnType, Integer> types = new EnumMap<>(ColumnType.class);
        List<Suspect> suspects = new ArrayList<>();
        Map<String, Integer> booleans = new TreeMap<>();
        int ok = 0;
        int filesWithSuspects = 0;
        int filesWithoutNumbers = 0;

        List<Path> files;
        try (Stream<Path> walk = Files.walk(dir)) {
            files = walk.filter(p -> p.toString().endsWith(".csv")).sorted().toList();
        }
        for (Path file : files) {
            String name = dir.relativize(file).toString().replace('\\', '/');
            ParsedCsv csv;
            try {
                csv = parser.parse(Files.readAllBytes(file));
            } catch (RuntimeException e) {
                failures.computeIfAbsent(reason(e), k -> new ArrayList<>()).add(name);
                continue;
            }
            ok++;
            List<ColumnSchema> schema = inferrer.infer(csv);
            boolean anyNumber = false;
            boolean anySuspect = false;
            for (int i = 0; i < schema.size(); i++) {
                ColumnSchema col = schema.get(i);
                types.merge(col.type(), 1, Integer::sum);
                if (col.type() == ColumnType.INTEGER || col.type() == ColumnType.DECIMAL) {
                    anyNumber = true;
                }
                if (col.type() == ColumnType.BOOLEAN) {
                    booleans.merge(distinctLower(csv.rows(), i), 1, Integer::sum);
                }
                if (col.type() == ColumnType.STRING) {
                    Suspect s = suspect(name, col.name(), csv.rows(), i);
                    if (s != null) {
                        suspects.add(s);
                        anySuspect = true;
                    }
                }
            }
            if (anySuspect) filesWithSuspects++;
            if (!anyNumber) filesWithoutNumbers++;
        }

        StringBuilder md = new StringBuilder("# Corpus report\n\n");
        md.append("| files | parsed | rejected | with suspect columns | with no numeric column |\n");
        md.append("|---|---|---|---|---|\n");
        md.append("| ").append(files.size()).append(" | ").append(ok).append(" | ")
            .append(files.size() - ok).append(" | ").append(filesWithSuspects).append(" | ")
            .append(filesWithoutNumbers).append(" |\n\n");
        md.append("Columns by type: ").append(types).append("; suspect text columns: ")
            .append(suspects.size()).append("\n\n## Rejections\n\n");
        failures.forEach((reason, names) -> md.append("- **").append(reason).append("** (")
            .append(names.size()).append("): ").append(String.join(", ", names.stream().limit(8).toList()))
            .append("\n"));
        md.append("\n## Boolean columns by their values\n\n").append(booleans).append("\n");
        md.append("\n## Suspect text columns\n\n");
        Map<String, Integer> byKind = new TreeMap<>();
        suspects.forEach(s -> byKind.merge(s.kind(), 1, Integer::sum));
        md.append("By kind: ").append(byKind).append("\n\n");
        for (Suspect s : suspects) {
            md.append("- ").append(s.file()).append(" `").append(clip(s.column())).append("` ")
                .append(s.kind()).append(String.format(" %.0f%%: ", s.share() * 100))
                .append(String.join(" | ", s.examples().stream().map(CorpusReportTest::clip).toList()))
                .append("\n");
        }
        Files.writeString(out, md);
        System.out.println(md.substring(0, md.indexOf("## Rejections")));
    }

    private static String reason(RuntimeException e) {
        String message = e.getMessage() == null ? "" : e.getMessage();
        // Row numbers and column names make every message unique; group by the shape.
        return e.getClass().getSimpleName() + ": "
            + message.replaceAll("[0-9]+", "N").replaceAll(":.*", ": ...");
    }

    /** A text column most of whose values look like numbers or dates: a typing miss. */
    private static Suspect suspect(String file, String column, List<List<String>> rows, int index) {
        List<String> values = rows.stream()
            .map(r -> index < r.size() ? r.get(index).trim() : "")
            .filter(v -> !v.isEmpty() && !MissingValues.isPlaceholder(v))
            .toList();
        if (values.size() < 5) {
            return null;
        }
        long numbers = values.stream().filter(v -> LOOSE_NUMBER.matcher(v).matches()).count();
        long dates = values.stream().filter(v -> LOOSE_DATE.matcher(v).matches()).count();
        long best = Math.max(numbers, dates);
        double share = (double) best / values.size();
        if (share < SUSPECT_SHARE) {
            return null;
        }
        Pattern pattern = numbers >= dates ? LOOSE_NUMBER : LOOSE_DATE;
        List<String> examples = values.stream().filter(v -> pattern.matcher(v).matches())
            .distinct().limit(3).toList();
        return new Suspect(file, column, numbers >= dates ? "number" : "date", share, examples);
    }

    private static String distinctLower(List<List<String>> rows, int index) {
        return rows.stream().map(r -> r.get(index).trim().toLowerCase(Locale.ROOT))
            .filter(v -> !v.isEmpty()).distinct().sorted().toList().toString();
    }

    private static String clip(String s) {
        return s.length() <= 40 ? s : s.substring(0, 40) + "...";
    }
}

package com.plotlineai.backend.dataset;

import com.plotlineai.backend.error.CsvParseException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;

/**
 * Turns an upload's bytes into text, or refuses them. A byte-order mark decides the encoding
 * when there is one; otherwise strict UTF-8, then windows-1252, which is what Excel on Windows
 * saves a "CSV" as. windows-1252 decodes any bytes at all, so binary content is refused first,
 * by its signature and by its share of control characters, never left to the fallback.
 */
final class CsvDecoder {

    record Decoded(String text, String encoding) {
    }

    private static final Charset WINDOWS_1252 = Charset.forName("windows-1252");

    /** How much of the file the binary checks read: enough to judge, bounded on 5 MB. */
    private static final int PROBE = 64 * 1024;

    /** Control characters (other than tab, CR, LF) tolerated per probe before it is binary. */
    private static final double MAX_CONTROL_SHARE = 0.01;

    private CsvDecoder() {
    }

    static Decoded decode(byte[] bytes) {
        refuseKnownBinary(bytes);
        Decoded decoded;
        if (startsWith(bytes, 0xEF, 0xBB, 0xBF)) {
            decoded = new Decoded(strict(StandardCharsets.UTF_8, bytes, 3), "UTF-8");
        } else if (startsWith(bytes, 0xFF, 0xFE)) {
            decoded = new Decoded(strict(StandardCharsets.UTF_16LE, bytes, 2), "UTF-16LE");
        } else if (startsWith(bytes, 0xFE, 0xFF)) {
            decoded = new Decoded(strict(StandardCharsets.UTF_16BE, bytes, 2), "UTF-16BE");
        } else {
            refuseNulBytes(bytes);
            String utf8 = strictOrNull(StandardCharsets.UTF_8, bytes, 0);
            decoded = utf8 != null
                ? new Decoded(utf8, "UTF-8")
                : new Decoded(new String(bytes, WINDOWS_1252), "windows-1252");
        }
        // A replacement character is evidence of binary only when the fallback produced it;
        // in strictly decoded text it was in the file all along.
        refuseBinaryText(decoded.text(), decoded.encoding().equals("windows-1252"));
        refuseWebPage(decoded.text());
        return decoded;
    }

    /** Files people commonly mistake for a CSV, by their first bytes. */
    private static void refuseKnownBinary(byte[] bytes) {
        if (startsWith(bytes, '%', 'P', 'D', 'F')) {
            throw new CsvParseException("pdf", "The file is a PDF, not CSV text");
        }
        if (startsWith(bytes, 'P', 'K', 3, 4) || startsWith(bytes, 0xD0, 0xCF, 0x11, 0xE0)) {
            throw new CsvParseException("spreadsheet", "The file is a spreadsheet or archive, not CSV text");
        }
    }

    private static void refuseNulBytes(byte[] bytes) {
        int end = Math.min(bytes.length, PROBE);
        for (int i = 0; i < end; i++) {
            if (bytes[i] == 0) {
                throw new CsvParseException("not_text", "The file is not text");
            }
        }
    }

    private static void refuseBinaryText(String text, boolean replacementsAreBinary) {
        int end = Math.min(text.length(), PROBE);
        int control = 0;
        for (int i = 0; i < end; i++) {
            char ch = text.charAt(i);
            boolean binaryLike = ch == 0 || ch == '\uFEFF' || (replacementsAreBinary && ch == '\uFFFD')
                || (Character.isISOControl(ch) && ch != '\t' && ch != '\r' && ch != '\n');
            if (binaryLike) {
                control++;
            }
        }
        // A stray control character or two is a typo in a text file; more is a binary file.
        if (control > Math.max(2, end * MAX_CONTROL_SHARE)) {
            throw new CsvParseException("not_text", "The file is not text");
        }
    }

    /** A saved web page or an error page served in place of a download. */
    private static void refuseWebPage(String text) {
        String head = text.substring(0, Math.min(text.length(), 256)).stripLeading()
            .toLowerCase(Locale.ROOT);
        if (head.startsWith("<!doctype html") || head.startsWith("<html")) {
            throw new CsvParseException("web_page", "The file is a web page, not CSV text");
        }
    }

    private static String strict(Charset charset, byte[] bytes, int offset) {
        String text = strictOrNull(charset, bytes, offset);
        if (text == null) {
            throw new CsvParseException("encoding", "The file is not valid " + charset.name() + " text");
        }
        return text;
    }

    private static String strictOrNull(Charset charset, byte[] bytes, int offset) {
        try {
            return charset.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes, offset, bytes.length - offset))
                .toString();
        } catch (CharacterCodingException e) {
            return null;
        }
    }

    private static boolean startsWith(byte[] bytes, int... prefix) {
        if (bytes.length < prefix.length) {
            return false;
        }
        int[] head = new int[prefix.length];
        for (int i = 0; i < prefix.length; i++) {
            head[i] = bytes[i] & 0xFF;
        }
        return Arrays.equals(head, prefix);
    }
}

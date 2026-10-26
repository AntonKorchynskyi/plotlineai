/**
 * The sample on the upload screen, for visitors without a CSV of their own: six months of
 * sales at a fictional coffee chain, one row per month, store and product. It carries a few
 * things worth finding: the campus store empties over the summer break, Riverside is still
 * growing, cold drinks peak in July and August, and lattes went up 25 cents in July.
 *
 * It goes through the same upload as any file; nothing downstream knows it is the sample.
 */

export const SAMPLE_FILE_NAME = "coffee-shop-sales.csv";

export const SAMPLE_CSV = `month,store,product,category,units,unit_price,revenue
2026-04,Downtown,Espresso,Coffee,517,3.20,1654.40
2026-04,Downtown,Latte,Coffee,1030,4.75,4892.50
2026-04,Downtown,Cappuccino,Coffee,609,4.50,2740.50
2026-04,Downtown,Cold Brew,Coffee,250,4.95,1237.50
2026-04,Downtown,Chai Latte,Tea,286,4.60,1315.60
2026-04,Downtown,Matcha Latte,Tea,213,5.25,1118.25
2026-04,Downtown,Croissant,Pastry,579,3.50,2026.50
2026-04,Downtown,Blueberry Muffin,Pastry,379,3.25,1231.75
2026-04,Riverside,Espresso,Coffee,233,3.20,745.60
2026-04,Riverside,Latte,Coffee,417,4.75,1980.75
2026-04,Riverside,Cappuccino,Coffee,275,4.50,1237.50
2026-04,Riverside,Cold Brew,Coffee,109,4.95,539.55
2026-04,Riverside,Chai Latte,Tea,146,4.60,671.60
2026-04,Riverside,Matcha Latte,Tea,97,5.25,509.25
2026-04,Riverside,Croissant,Pastry,249,3.50,871.50
2026-04,Riverside,Blueberry Muffin,Pastry,180,3.25,585.00
2026-04,Campus,Espresso,Coffee,452,3.20,1446.40
2026-04,Campus,Latte,Coffee,843,4.75,4004.25
2026-04,Campus,Cappuccino,Coffee,582,4.50,2619.00
2026-04,Campus,Cold Brew,Coffee,233,4.95,1153.35
2026-04,Campus,Chai Latte,Tea,241,4.60,1108.60
2026-04,Campus,Matcha Latte,Tea,190,5.25,997.50
2026-04,Campus,Croissant,Pastry,452,3.50,1582.00
2026-04,Campus,Blueberry Muffin,Pastry,366,3.25,1189.50
2026-05,Downtown,Espresso,Coffee,529,3.20,1692.80
2026-05,Downtown,Latte,Coffee,941,4.75,4469.75
2026-05,Downtown,Cappuccino,Coffee,570,4.50,2565.00
2026-05,Downtown,Cold Brew,Coffee,357,4.95,1767.15
2026-05,Downtown,Chai Latte,Tea,273,4.60,1255.80
2026-05,Downtown,Matcha Latte,Tea,263,5.25,1380.75
2026-05,Downtown,Croissant,Pastry,571,3.50,1998.50
2026-05,Downtown,Blueberry Muffin,Pastry,414,3.25,1345.50
2026-05,Riverside,Espresso,Coffee,286,3.20,915.20
2026-05,Riverside,Latte,Coffee,518,4.75,2460.50
2026-05,Riverside,Cappuccino,Coffee,334,4.50,1503.00
2026-05,Riverside,Cold Brew,Coffee,195,4.95,965.25
2026-05,Riverside,Chai Latte,Tea,154,4.60,708.40
2026-05,Riverside,Matcha Latte,Tea,140,5.25,735.00
2026-05,Riverside,Croissant,Pastry,299,3.50,1046.50
2026-05,Riverside,Blueberry Muffin,Pastry,213,3.25,692.25
2026-05,Campus,Espresso,Coffee,348,3.20,1113.60
2026-05,Campus,Latte,Coffee,706,4.75,3353.50
2026-05,Campus,Cappuccino,Coffee,484,4.50,2178.00
2026-05,Campus,Cold Brew,Coffee,283,4.95,1400.85
2026-05,Campus,Chai Latte,Tea,193,4.60,887.80
2026-05,Campus,Matcha Latte,Tea,185,5.25,971.25
2026-05,Campus,Croissant,Pastry,429,3.50,1501.50
2026-05,Campus,Blueberry Muffin,Pastry,283,3.25,919.75
2026-06,Downtown,Espresso,Coffee,488,3.20,1561.60
2026-06,Downtown,Latte,Coffee,821,4.75,3899.75
2026-06,Downtown,Cappuccino,Coffee,592,4.50,2664.00
2026-06,Downtown,Cold Brew,Coffee,525,4.95,2598.75
2026-06,Downtown,Chai Latte,Tea,233,4.60,1071.80
2026-06,Downtown,Matcha Latte,Tea,315,5.25,1653.75
2026-06,Downtown,Croissant,Pastry,604,3.50,2114.00
2026-06,Downtown,Blueberry Muffin,Pastry,393,3.25,1277.25
2026-06,Riverside,Espresso,Coffee,298,3.20,953.60
2026-06,Riverside,Latte,Coffee,552,4.75,2622.00
2026-06,Riverside,Cappuccino,Coffee,350,4.50,1575.00
2026-06,Riverside,Cold Brew,Coffee,321,4.95,1588.95
2026-06,Riverside,Chai Latte,Tea,138,4.60,634.80
2026-06,Riverside,Matcha Latte,Tea,199,5.25,1044.75
2026-06,Riverside,Croissant,Pastry,365,3.50,1277.50
2026-06,Riverside,Blueberry Muffin,Pastry,278,3.25,903.50
2026-06,Campus,Espresso,Coffee,155,3.20,496.00
2026-06,Campus,Latte,Coffee,315,4.75,1496.25
2026-06,Campus,Cappuccino,Coffee,191,4.50,859.50
2026-06,Campus,Cold Brew,Coffee,182,4.95,900.90
2026-06,Campus,Chai Latte,Tea,83,4.60,381.80
2026-06,Campus,Matcha Latte,Tea,102,5.25,535.50
2026-06,Campus,Croissant,Pastry,196,3.50,686.00
2026-06,Campus,Blueberry Muffin,Pastry,140,3.25,455.00
2026-07,Downtown,Espresso,Coffee,432,3.20,1382.40
2026-07,Downtown,Latte,Coffee,823,5.00,4115.00
2026-07,Downtown,Cappuccino,Coffee,515,4.50,2317.50
2026-07,Downtown,Cold Brew,Coffee,647,4.95,3202.65
2026-07,Downtown,Chai Latte,Tea,198,4.60,910.80
2026-07,Downtown,Matcha Latte,Tea,354,5.25,1858.50
2026-07,Downtown,Croissant,Pastry,575,3.50,2012.50
2026-07,Downtown,Blueberry Muffin,Pastry,410,3.25,1332.50
2026-07,Riverside,Espresso,Coffee,297,3.20,950.40
2026-07,Riverside,Latte,Coffee,593,5.00,2965.00
2026-07,Riverside,Cappuccino,Coffee,393,4.50,1768.50
2026-07,Riverside,Cold Brew,Coffee,497,4.95,2460.15
2026-07,Riverside,Chai Latte,Tea,162,4.60,745.20
2026-07,Riverside,Matcha Latte,Tea,253,5.25,1328.25
2026-07,Riverside,Croissant,Pastry,392,3.50,1372.00
2026-07,Riverside,Blueberry Muffin,Pastry,282,3.25,916.50
2026-07,Campus,Espresso,Coffee,117,3.20,374.40
2026-07,Campus,Latte,Coffee,202,5.00,1010.00
2026-07,Campus,Cappuccino,Coffee,132,4.50,594.00
2026-07,Campus,Cold Brew,Coffee,169,4.95,836.55
2026-07,Campus,Chai Latte,Tea,54,4.60,248.40
2026-07,Campus,Matcha Latte,Tea,86,5.25,451.50
2026-07,Campus,Croissant,Pastry,135,3.50,472.50
2026-07,Campus,Blueberry Muffin,Pastry,103,3.25,334.75
2026-08,Downtown,Espresso,Coffee,431,3.20,1379.20
2026-08,Downtown,Latte,Coffee,820,5.00,4100.00
2026-08,Downtown,Cappuccino,Coffee,473,4.50,2128.50
2026-08,Downtown,Cold Brew,Coffee,641,4.95,3172.95
2026-08,Downtown,Chai Latte,Tea,225,4.60,1035.00
2026-08,Downtown,Matcha Latte,Tea,348,5.25,1827.00
2026-08,Downtown,Croissant,Pastry,559,3.50,1956.50
2026-08,Downtown,Blueberry Muffin,Pastry,377,3.25,1225.25
2026-08,Riverside,Espresso,Coffee,385,3.20,1232.00
2026-08,Riverside,Latte,Coffee,606,5.00,3030.00
2026-08,Riverside,Cappuccino,Coffee,439,4.50,1975.50
2026-08,Riverside,Cold Brew,Coffee,550,4.95,2722.50
2026-08,Riverside,Chai Latte,Tea,180,4.60,828.00
2026-08,Riverside,Matcha Latte,Tea,297,5.25,1559.25
2026-08,Riverside,Croissant,Pastry,438,3.50,1533.00
2026-08,Riverside,Blueberry Muffin,Pastry,306,3.25,994.50
2026-08,Campus,Espresso,Coffee,132,3.20,422.40
2026-08,Campus,Latte,Coffee,219,5.00,1095.00
2026-08,Campus,Cappuccino,Coffee,151,4.50,679.50
2026-08,Campus,Cold Brew,Coffee,214,4.95,1059.30
2026-08,Campus,Chai Latte,Tea,67,4.60,308.20
2026-08,Campus,Matcha Latte,Tea,99,5.25,519.75
2026-08,Campus,Croissant,Pastry,157,3.50,549.50
2026-08,Campus,Blueberry Muffin,Pastry,127,3.25,412.75
2026-09,Downtown,Espresso,Coffee,459,3.20,1468.80
2026-09,Downtown,Latte,Coffee,835,5.00,4175.00
2026-09,Downtown,Cappuccino,Coffee,548,4.50,2466.00
2026-09,Downtown,Cold Brew,Coffee,460,4.95,2277.00
2026-09,Downtown,Chai Latte,Tea,261,4.60,1200.60
2026-09,Downtown,Matcha Latte,Tea,266,5.25,1396.50
2026-09,Downtown,Croissant,Pastry,582,3.50,2037.00
2026-09,Downtown,Blueberry Muffin,Pastry,401,3.25,1303.25
2026-09,Riverside,Espresso,Coffee,405,3.20,1296.00
2026-09,Riverside,Latte,Coffee,786,5.00,3930.00
2026-09,Riverside,Cappuccino,Coffee,516,4.50,2322.00
2026-09,Riverside,Cold Brew,Coffee,428,4.95,2118.60
2026-09,Riverside,Chai Latte,Tea,231,4.60,1062.60
2026-09,Riverside,Matcha Latte,Tea,273,5.25,1433.25
2026-09,Riverside,Croissant,Pastry,469,3.50,1641.50
2026-09,Riverside,Blueberry Muffin,Pastry,360,3.25,1170.00
2026-09,Campus,Espresso,Coffee,444,3.20,1420.80
2026-09,Campus,Latte,Coffee,859,5.00,4295.00
2026-09,Campus,Cappuccino,Coffee,588,4.50,2646.00
2026-09,Campus,Cold Brew,Coffee,477,4.95,2361.15
2026-09,Campus,Chai Latte,Tea,261,4.60,1200.60
2026-09,Campus,Matcha Latte,Tea,248,5.25,1302.00
2026-09,Campus,Croissant,Pastry,540,3.50,1890.00
2026-09,Campus,Blueberry Muffin,Pastry,365,3.25,1186.25
`;

/** The sample as a file, ready for the upload flow. */
export const sampleFile = () => new File([SAMPLE_CSV], SAMPLE_FILE_NAME, { type: "text/csv" });

/**
 * Header and rows for the preview table. A plain split is enough: we wrote the file, and no
 * value holds a comma or a quote.
 */
export function sampleTable(): { header: string[]; rows: string[][] } {
  const [header, ...rows] = SAMPLE_CSV.trimEnd()
    .split("\n")
    .map((line) => line.split(","));
  return { header, rows };
}

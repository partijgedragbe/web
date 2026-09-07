import { readParquets, withParquets } from "./lib/duckdb.js";

const FILES = {
  commissions: "src/data/commissions.parquet",
  members: "src/data/members.parquet",
};

const mapMembers = (str, fractionLookup) =>
  (str || "").split(",").map((m) => {
    const name = m.trim();
    return { name, fraction: fractionLookup[name] ?? "Unknown" };
  }).filter((m) => m.name !== "");

export default async function () {
  return withParquets({
    context: "commissions",
    requiredFiles: Object.values(FILES),
    fallback: { commissions: [], memberParties: {} },
    loader: async (connection) => {
      const {
        commissions: commissionsRows,
        members: membersRows,
      } = await readParquets(connection, FILES);

      const session56Members = membersRows.filter(
        (row) => String(row[1]) === "56",
      );

      const fractionLookup = Object.fromEntries(
        session56Members.map((r) => [`${r[2]} ${r[3]}`, r[8]]),
      );

      const commissions = commissionsRows.map((row) => ({
        name: row[0],
        type: row[1],
        chairs: mapMembers(row[2], fractionLookup),
        subchairs: mapMembers(row[3], fractionLookup),
        permanent_members: mapMembers(row[4], fractionLookup),
        replacement_members: mapMembers(row[5], fractionLookup),
      }));

      return {
        commissions,
        memberParties: fractionLookup,
      };
    },
  });
}

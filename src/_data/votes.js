import { readParquets, withParquets } from "./lib/duckdb.js";

const FILES = {
  votes: "src/data/sessions/56/plenary/votes.parquet",
  members: "src/data/members.parquet",
};

const withFraction = (name, lookup) => ({
  name,
  fraction: lookup[name] ?? "Unknown",
});

const parseMembers = (raw, lookup) =>
  (raw || "").split(",").map((n) => withFraction(n.trim(), lookup)).filter((
    m,
  ) => m.name !== "");

const groupVotesByFraction = (yesWith, noWith, abstainWith) => {
  const grouped = {};
  [["yes", yesWith], ["no", noWith], ["abstain", abstainWith]].forEach(
    ([type, members]) => {
      members.forEach(({ name, fraction }) => {
        if (!grouped[fraction]) {
          grouped[fraction] = { yes: [], no: [], abstain: [] };
        }
        grouped[fraction][type].push({ name, fraction });
      });
    },
  );
  return grouped;
};

export default async function () {
  return withParquets({
    context: "votes",
    requiredFiles: Object.values(FILES),
    fallback: { votes: [] },
    loader: async (connection) => {
      const { votes: votesRows, members: membersRows } = await readParquets(
        connection,
        FILES,
      );

      const fractionLookup = Object.fromEntries(
        membersRows.map((r) => [`${r[2]} ${r[3]}`, r[8]]),
      );

      return {
        votes: votesRows.map((row) => {
          const yesWith = parseMembers(row[9], fractionLookup);
          const noWith = parseMembers(row[10], fractionLookup);
          const abstainWith = parseMembers(row[11], fractionLookup);
          const grouped = groupVotesByFraction(yesWith, noWith, abstainWith);

          return {
            vote_id: row[0],
            session_id: row[1],
            meeting_id: row[2],
            date: row[3],
            title_nl: row[4],
            title_fr: row[5],
            yes_count: row[6],
            no_count: row[7],
            abstain_count: row[8],
            members_yes: row[9],
            members_no: row[10],
            members_abstain: row[11],
            dossier_id: row[12],
            document_id: row[13],
            motion_id: row[14],
            yes_members: yesWith,
            no_members: noWith,
            abstain_members: abstainWith,
            votes_by_fraction: Object.fromEntries(
              Object.entries(grouped).map(([p, v]) => [p, {
                yes: v.yes.length,
                no: v.no.length,
                abstain: v.abstain.length,
              }]),
            ),
          };
        }),
      };
    },
  });
}

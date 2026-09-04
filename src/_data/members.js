import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { hashText } from "./lib/utils.js";
import { readParquets, withParquets } from "./lib/duckdb.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fractionColors = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fractionColors.json"), "utf-8"),
);
const topics = JSON.parse(
  fs.readFileSync(path.join(__dirname, "topics.json"), "utf-8"),
);

const FILES = {
  members: "src/data/members.parquet",
  plenaryMeetings: "src/data/sessions/56/plenary/meetings.parquet",
  commissionMeetings: "src/data/sessions/56/commission/meetings.parquet",
  plenaryQuestions: "src/data/sessions/56/plenary/questions.parquet",
  commissionQuestions: "src/data/sessions/56/commission/questions.parquet",
  commissions: "src/data/commissions.parquet",
  propositions: "src/data/sessions/56/plenary/propositions.parquet",
  dossiers: "src/data/sessions/56/dossiers.parquet",
  subdocuments: "src/data/sessions/56/subdocuments.parquet",
  votes: "src/data/sessions/56/plenary/votes.parquet",
  plenaryQuestionDiscussionsSummaries:
    "src/data/summaries/plenary_question_discussions.parquet",
  commissionQuestionDiscussionsSummaries:
    "src/data/summaries/commission_question_discussions.parquet",
  plenaryQuestionTopicsSummaries:
    "src/data/summaries/plenary_question_topics.parquet",
  commissionQuestionTopicsSummaries:
    "src/data/summaries/commission_question_topics.parquet",
};

const FALLBACK = { memberCount: 0, members: [], ages: [] };

const toKey = (name) => name.trim().toLowerCase().replace(/\s+/g, "-");

const convertDate = (raw) => {
  if (!raw || typeof raw !== "string") return null;
  const [day, month, year] = raw.split("/");
  if (!day || !month || !year) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
};

const calcAge = (rawDate) => {
  const birth = new Date(rawDate);
  if (isNaN(birth)) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (
    now.getMonth() - birth.getMonth() < 0 ||
    (now.getMonth() - birth.getMonth() === 0 &&
      now.getDate() - birth.getDate() < 0)
  ) age--;
  return age;
};

const parseNames = (str, lookup) =>
  (str || "").split(",").map((n) => ({
    name: n.trim(),
    fraction: lookup[n.trim()] ?? "Unknown",
  }));

const buildQuestion = (row, type, dateMap, fractionLookup, summaryByHash) => {
  const [questionId, sessionId, meetingId] = row;
  const date = dateMap.get(`${sessionId}-${meetingId}`) ?? null;
  const questioners = parseNames(row[3], fractionLookup);
  const questionees = parseNames(row[4], fractionLookup);
  const respondents = parseNames(row[5], fractionLookup);
  const topics_nl = (row[6] || "").split(";").map((t) => t.trim());
  const topics_fr = (row[7] || "").split(";").map((t) => t.trim());
  const rawTopicsNl = row[6] || "";
  const topics_summary_nl = rawTopicsNl
    ? (summaryByHash[hashText(rawTopicsNl)] ?? null)
    : null;
  const rawDiscussion = row[8] || "";
  const discussion = JSON.parse(rawDiscussion || "[]").map((d) => ({
    speaker: d.speaker,
    text: d.text,
  }));
  const discussion_summary_nl =
    rawDiscussion.trim() && rawDiscussion.trim() !== "[]"
      ? (summaryByHash[hashText(rawDiscussion)] ?? null)
      : null;
  return {
    questionId,
    sessionId,
    meetingId,
    date,
    questioners,
    respondents,
    topics_nl,
    topics_fr,
    topics_summary_nl,
    discussion,
    discussion_summary_nl,
    type,
  };
};

const pushQuestion = (
  memberMap,
  key,
  question,
  asRespondent,
  topics_nl,
  topics_fr,
  index,
  targetField,
) => {
  if (!memberMap.has(key)) return;
  memberMap.get(key)[targetField].push({
    question_id: question.questionId,
    session_id: question.sessionId,
    meeting_id: question.meetingId,
    date: question.date,
    type: question.type,
    topic_nl: topics_nl[index] ?? null,
    topic_fr: topics_fr[index] ?? null,
    topics_nl: question.topics_nl,
    topics_fr: question.topics_fr,
    topics_summary_nl: question.topics_summary_nl,
    questioners: question.questioners,
    questionees: question.questionees,
    respondents: question.respondents,
    discussion: question.discussion,
    discussion_summary_nl: question.discussion_summary_nl,
    asRespondent,
  });
};

export default async function () {
  return withParquets({
    context: "members",
    requiredFiles: Object.values(FILES),
    fallback: FALLBACK,
    loader: async (connection) => {
      const {
        members: membersRows,
        plenaryQuestions: questionsRows,
        commissionQuestions: commissionQuestionsRows,
        plenaryMeetings: meetingsRows,
        commissionMeetings: commissionMeetingsRows,
        commissions: commissionsRows,
        plenaryQuestionDiscussionsSummaries:
          plenaryQuestionDiscussionsSummariesRows,
        commissionQuestionDiscussionsSummaries:
          commissionQuestionDiscussionsSummariesRows,
        plenaryQuestionTopicsSummaries: plenaryQuestionTopicsSummariesRows,
        commissionQuestionTopicsSummaries:
          commissionQuestionTopicsSummariesRows,
        votes: votesRows,
        propositions: propositionsRows,
        dossiers: dossiersRows,
        subdocuments: subdocumentsRows,
      } = await readParquets(connection, FILES);

      // ── Lookup tables ──────────────────────────────────────────────────────

      const summaryByHash = Object.fromEntries(
        plenaryQuestionDiscussionsSummariesRows.map((r) => [r[0], r[2]])
          .concat(
            commissionQuestionDiscussionsSummariesRows.map((r) => [r[0], r[2]]),
          )
          .concat(plenaryQuestionTopicsSummariesRows.map((r) => [r[0], r[2]]))
          .concat(
            commissionQuestionTopicsSummariesRows.map((r) => [r[0], r[2]]),
          ),
      );

      const meetingDateMap = new Map(
        meetingsRows.map((r) => [`${r[0]}-${r[1]}`, r[2]]),
      );
      const commissionDateMap = new Map(
        commissionMeetingsRows.map((r) => [`${r[0]}-${r[1]}`, r[2]]),
      );
      const fractionLookup = Object.fromEntries(
        membersRows.map((r) => [`${r[2]} ${r[3]}`, r[8]]),
      );

      const dossierById = {};
      const dossierMap = new Map();
      dossiersRows.forEach((d) => {
        const authors = (d[4] || "").split(",").map((a) => toKey(a)).filter(
          Boolean,
        );
        dossierMap.set(d[1], { sessionId: d[0], title: d[3], authors });
        dossierById[d[1]] = {
          authors,
          document_type: d[8],
          status: d[9],
          vote_date: convertDate(d[7]),
        };
      });

      // ── Build memberMap ────────────────────────────────────────────────────

      const memberMap = new Map();
      membersRows.forEach((row) => {
        const key = toKey(`${row[2]} ${row[3]}`);

        if (!memberMap.has(key)) {
          memberMap.set(key, {
            member_id: row[0],
            first_name: row[2],
            last_name: row[3],
            date_of_birth: row[4],
            place_of_birth: row[5],
            language: row[6],
            constituency: row[7],
            fraction: row[8],
            function: row[9],
            email: row[10],
            active: row[11],
            start_date: row[12],
            end_date: row[13],
            sessions: new Set([row[1]]),
            age: calcAge(row[4]),
            propositions: [],
            questions: [],
            commissionQuestions: [],
            votes: [],
            commissions: [],
          });
        } else {
          const m = memberMap.get(key);

          m.sessions.add(row[1]);

          if (m.language == null) m.language = row[6];
          if (m.function == null) m.function = row[9];
          if (m.email == null) m.email = row[10];
          if (m.start_date == null) m.start_date = row[12];
          if (m.end_date == null) m.end_date = row[13];
        }
      });

      // ── Commissions ────────────────────────────────────────────────────────

      commissionsRows.forEach((row) => {
        const [commissionName, type] = row;
        const roleGroups = [
          { names: (row[2] || "").split(","), role: "chair" },
          { names: (row[3] || "").split(","), role: "subchair" },
          { names: (row[4] || "").split(","), role: "member" },
        ];
        roleGroups.forEach(({ names, role }) =>
          names.forEach((name) => {
            const key = toKey(name);
            if (memberMap.has(key)) {
              memberMap.get(key).commissions.push({
                commission: commissionName,
                type,
                role,
              });
            }
          })
        );
      });

      // ── Propositions ───────────────────────────────────────────────────────

      propositionsRows.forEach((prop) => {
        const [
          propId,
          sessionId,
          meetingId,
          titleNl,
          titleFr,
          dossierId,
          documentId,
        ] = prop;
        const date = meetingDateMap.get(`${sessionId}-${meetingId}`) ?? null;
        const dossier = dossierMap.get(dossierId);
        if (!dossier) return;
        const dossierData = dossierById[dossierId] ?? {};
        dossier.authors.forEach((authorKey) => {
          if (!memberMap.has(authorKey)) return;
          const member = memberMap.get(authorKey);
          if (
            member.propositions.some((p) =>
              p.proposition_id === propId && p.dossier_id === dossierId
            )
          ) return;
          member.propositions.push({
            proposition_id: propId,
            session_id: sessionId,
            meeting_id: meetingId,
            date,
            title_nl: titleNl,
            title_fr: titleFr,
            dossier_id: dossierId,
            document_id: documentId,
            dossier_title: dossier.title,
            document_type: dossierData.document_type ?? null,
            status: dossierData.status ?? null,
            vote_date: dossierData.vote_date,
          });
        });
      });

      // ── Subdocuments ───────────────────────────────────────────────────────

      subdocumentsRows.forEach((subdoc) => {
        (subdoc[4] || "").split(",").forEach((name) => {
          const key = toKey(name);
          if (!memberMap.has(key)) return;
          const member = memberMap.get(key);
          if (!member.subdocuments) member.subdocuments = [];
          member.subdocuments.push({ date: subdoc[2], type: subdoc[3] });
        });
      });

      // ── Questions (plenary + commission) ──────────────────────────────────

      const processQuestions = (rows, dateMap, targetField) =>
        rows.forEach((row) => {
          if (row[0] === "404") return;
          const q = buildQuestion(
            row,
            targetField === "questions" ? "plenary" : "commission",
            dateMap,
            fractionLookup,
            summaryByHash,
          );
          q.questioners.forEach((questioner, i) => {
            pushQuestion(
              memberMap,
              toKey(questioner.name),
              q,
              false,
              q.topics_nl,
              q.topics_fr,
              i,
              targetField,
            );
          });
          q.respondents.forEach((respondent) => {
            pushQuestion(
              memberMap,
              toKey(respondent.name),
              q,
              true,
              q.topics_nl,
              q.topics_fr,
              0,
              targetField,
            );
          });
        });

      processQuestions(questionsRows, meetingDateMap, "questions");
      processQuestions(
        commissionQuestionsRows,
        commissionDateMap,
        "commissionQuestions",
      );

      // ── Votes ──────────────────────────────────────────────────────────────

      votesRows.forEach((vote) => {
        const toKeys = (raw) => (raw || "").split(",").map((n) => toKey(n));
        const yes = toKeys(vote[9]),
          no = toKeys(vote[10]),
          abstain = toKeys(vote[11]);
        const voteTypeOf = (k) =>
          yes.includes(k) ? "yes" : no.includes(k) ? "no" : "abstain";

        const fractionVotes = new Map();
        [...yes, ...no, ...abstain].forEach((k) => {
          const fraction = memberMap.get(k)?.fraction;
          if (!fraction) return;
          if (!fractionVotes.has(fraction)) {
            fractionVotes.set(fraction, { yes: 0, no: 0, abstain: 0 });
          }
          fractionVotes.get(fraction)[voteTypeOf(k)]++;
        });

        const majorityOf = (fraction) => {
          const c = fractionVotes.get(fraction);
          if (!c) return "abstain";
          if (c.yes > c.no && c.yes > c.abstain) return "yes";
          if (c.no > c.yes && c.no > c.abstain) return "no";
          return "abstain";
        };

        [...yes, ...no, ...abstain].forEach((k) => {
          if (!memberMap.has(k)) return;
          const member = memberMap.get(k);
          const voteType = voteTypeOf(k);
          member.votes.push({
            vote_id: vote[0],
            session_id: vote[1],
            meeting_id: vote[2],
            date: vote[3],
            title_nl: vote[4],
            title_fr: vote[5],
            vote: voteType,
            outlier: voteType !== majorityOf(member.fraction),
          });
        });
      });

      // ── Serialise & derive stats ───────────────────────────────────────────

      const members = Array.from(memberMap.values()).map((m) => ({
        ...m,
        sessions: Array.from(m.sessions),
      }));

      members.filter((row) => String(row[1]) === "56").forEach((member) => {
        const eligibleVotes = votesRows.filter((r) =>
          new Date(r[3]) >= new Date(member.start_date)
        );
        member.attendance = member.votes.length / (eligibleVotes.length || 1);
        const eligibleDays = new Set(eligibleVotes.map((r) => r[3]));
        const attendedDays = new Set(member.votes.map((v) => v.date));
        member.normalizedAttendance = eligibleDays.size === 0
          ? 0
          : attendedDays.size / eligibleDays.size;
        const outlierVotes = member.votes.filter((v) => v.outlier).length;
        member.outlier = member.votes.length > 0
          ? 100 - Math.round((outlierVotes / member.votes.length) * 1000) / 10
          : 100;
      });

      const fractionStats = new Map();
      members
        .filter((m) => m.active !== "false")
        .forEach((m) => {
          const fraction = m.fraction;

          if (!fraction) return;

          const key = fraction.trim().toLowerCase();

          if (!fractionStats.has(fraction)) {
            fractionStats.set(fraction, {
              seats: 0,
              color: fractionColors[key]?.primary ?? "gray",
            });
          }

          fractionStats.get(fraction).seats++;
        });

      const fractions = Array.from(fractionStats.entries())
        .map(([name, data]) => ({
          name,
          ...data,
        }))
        .sort((a, b) => b.seats - a.seats);

      // ── Top contributors by topic ──────────────────────────────────────────

      const topicMemberCounts = new Map();
      const registerContribution = (key, fullName, fraction, type) => {
        if (!topicMemberCounts.has(key)) topicMemberCounts.set(key, new Map());
        const mc = topicMemberCounts.get(key);
        if (!mc.has(fullName)) {
          mc.set(fullName, { questions: 0, propositions: 0, fraction });
        }
        mc.get(fullName)[type]++;
      };

      members.forEach((member) => {
        const fullName = `${member.first_name} ${member.last_name}`;
        const countContributions = (items, type) => {
          (items || []).forEach((item) => {
            const title = (item.topic_nl || item.title_nl || "").toLowerCase();
            for (const [topicKey, data] of Object.entries(topics)) {
              if (data.subtopics) {
                for (
                  const [subtopicKey, subKeywords] of Object.entries(
                    data.subtopics,
                  )
                ) {
                  if (
                    subKeywords.some((kw) => title.includes(kw.toLowerCase()))
                  ) {
                    registerContribution(
                      subtopicKey,
                      fullName,
                      member.fraction,
                      type,
                    );
                  }
                }
              }
              if (
                data.keywords.some((kw) => title.includes(kw.toLowerCase()))
              ) {
                registerContribution(topicKey, fullName, member.fraction, type);
              }
            }
          });
        };
        countContributions(member.questions, "questions");
        countContributions(member.propositions, "propositions");
      });

      const topContributorsByTopic = Object.fromEntries(
        Array.from(topicMemberCounts.entries()).map(([topic, mc]) => [
          topic,
          Array.from(mc.entries())
            .sort((a, b) =>
              (b[1].questions + b[1].propositions) -
              (a[1].questions + a[1].propositions)
            )
            .slice(0, 5)
            .map(([name, c]) => ({
              name,
              fraction: c.fraction,
              total: c.questions + c.propositions,
              questions: c.questions,
              propositions: c.propositions,
            })),
        ]),
      );

      return {
        memberCount: membersRows.length,
        members,
        ages: members.map((m) => m.age),
        fractions,
        topContributorsByTopic,
      };
    },
  });
}

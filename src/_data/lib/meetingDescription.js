export function meetingDescription(meeting) {
  if (!meeting) return "";

  const topics = [];

  for (const question of meeting.questions || []) {
    if (question.topics_summary_nl) {
      topics.push(cleanTopic(question.topics_summary_nl));
    } else if (Array.isArray(question.topics_nl) && question.topics_nl.length) {
      topics.push(cleanTopic(question.topics_nl[0]));
    }
  }

  const uniqueTopics = [...new Set(topics)].filter(Boolean).slice(0, 3);

  const topicPart = uniqueTopics.length > 0
    ? `kwamen onder meer ${naturalList(uniqueTopics)} aan bod`
    : null;

  const extraParts = [];

  if (meeting.propositions?.length) {
    extraParts.push(
      `${meeting.propositions.length} ${
        meeting.propositions.length === 1 ? "wetsvoorstel" : "wetsvoorstellen"
      }`,
    );
  }

  if (meeting.allVotes?.length) {
    extraParts.push(
      `${meeting.allVotes.length} ${
        meeting.allVotes.length === 1 ? "stemming" : "stemmingen"
      }`,
    );
  }

  const extraPart = extraParts.length
    ? `werden ${naturalList(extraParts)} besproken`
    : null;

  if (!topicPart && !extraPart) {
    return "Overzicht van de plenaire vergadering van de Kamer van Volksvertegenwoordigers.";
  }

  if (topicPart && extraPart) {
    return `In deze vergadering ${topicPart}. Daarnaast ${extraPart}.`;
  }

  if (topicPart) {
    return `Tijdens deze plenaire vergadering ${topicPart}.`;
  }

  // only extraPart
  return `Tijdens deze plenaire vergadering ${extraPart}.`;
}

function cleanTopic(topic) {
  if (!topic) return "";

  topic = topic.trim();

  // lowercase first letter only
  topic = topic.charAt(0).toLowerCase() + topic.slice(1);

  // remove trailing punctuation
  topic = topic.replace(/[.!?]+$/, "");

  // NEW: wrap in quotes
  return `${topic}`;
}

function naturalList(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} en ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, en ${items.at(-1)}`;
}

// Questionnaire progress counts, from the rows. Stored with the questionnaire so lists don't need every row.
export function counts(qn) {
  const c = { total: 0, approved: 0, toReview: 0, gaps: 0, routed: 0, expert: 0, existing: 0, high: 0, medium: 0, answered: 0 };
  for (const r of qn?.rows || []) {
    c.total++;
    if (r.status === 'approved') c.approved++;
    if (r.status === 'answered') c.expert++;
    if (r.status === 'existing') c.existing++;
    if (r.status === 'drafted') c.toReview++;
    if (r.status === 'gap') c.gaps++;
    if (r.status === 'routed') c.routed++;
    if (r.status === 'drafted' && r.confidence === 'high') c.high++;
    if (r.status === 'drafted' && r.confidence === 'medium') c.medium++;
    if (r.answer?.text || r.status === 'existing') c.answered++;
  }
  c.done = c.approved + c.expert + c.existing;
  return c;
}

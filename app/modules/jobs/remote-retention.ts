export function shouldRetainRemoteObject(input: {
  receivedAt: string;
  now: Date;
  locallyReferenced: boolean;
  activeDiscussion: boolean;
  moderationEvidence: boolean;
}) {
  if (
    input.locallyReferenced ||
    input.activeDiscussion ||
    input.moderationEvidence
  )
    return true;
  return (
    input.now.getTime() - new Date(input.receivedAt).getTime() <
    90 * 24 * 60 * 60 * 1000
  );
}

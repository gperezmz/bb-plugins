// The list's live region: reorder announcements. It is in the page from the
// start, so a screen reader hears the first announcement.
import { useAnnouncement } from "../store/hooks";

export function Announcer() {
  const text = useAnnouncement();
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {text}
    </div>
  );
}

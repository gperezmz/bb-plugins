// "Snooze until": the picker behind Pick date & time…, from a card's clock
// menu and from bb's thread menu alike. A calendar that starts on Monday, a
// time field and a preview of when the thread wakes.
import { useEffect, useState } from "react";
import { DayPicker } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { isPickableSnoozeDay } from "@/shared/snooze";
import { initialPicker, pickedWake, pickerError, pickerPreview, type PickerForm } from "../model/snooze-form";
import { useDialogContext } from "./use-dialog-context";

/** How often the open dialog reads the clock again, ms. */
const CLOCK_MS = 15_000;

const CALENDAR_CLASSES = {
  root: "w-fit",
  months: "relative",
  month_caption: "flex h-8 items-center justify-center text-sm font-medium",
  nav: "absolute inset-x-0 top-0 flex items-center justify-between",
  button_previous: "inline-flex size-8 cursor-pointer items-center justify-center rounded-md hover:bg-state-hover disabled:opacity-40",
  button_next: "inline-flex size-8 cursor-pointer items-center justify-center rounded-md hover:bg-state-hover disabled:opacity-40",
  chevron: "size-4 fill-current",
  month_grid: "border-collapse",
  weekday: "size-8 text-xs font-normal text-muted-foreground",
  day: "p-0 text-center",
  day_button: "size-8 cursor-pointer rounded-md text-sm hover:bg-state-hover disabled:cursor-default disabled:hover:bg-transparent",
  selected: "[&>button]:bg-foreground [&>button]:text-background [&>button]:hover:bg-foreground",
  disabled: "opacity-35",
  outside: "text-muted-foreground",
  today: "font-semibold",
};

export function SnoozeDialog({ threadId, onClose }: { threadId: string; onClose(): void }) {
  const { threads, commands } = useDialogContext();
  const title = threads.find((thread) => thread.id === threadId)?.displayTitle ?? "this thread";
  const [now, setNow] = useState(() => Date.now());
  const [form, setForm] = useState<PickerForm>(() => initialPicker(new Date()));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);
  const error = pickerError(form, now);
  const preview = pickerPreview(form, now);
  const today = new Date(now);

  const submit = () => {
    const until = pickedWake(form);
    const current = Date.now();
    setNow(current);
    if (until === null || pickerError(form, current) !== null) return;
    onClose();
    void commands.snooze(threadId, until);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Snooze until</DialogTitle>
          <DialogDescription className="truncate">{title}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DayPicker
            mode="single"
            weekStartsOn={1}
            selected={form.date ?? undefined}
            defaultMonth={form.date ?? today}
            onSelect={(date) => date !== undefined && setForm((current) => ({ ...current, date }))}
            disabled={(day) => !isPickableSnoozeDay(day, today)}
            classNames={CALENDAR_CLASSES}
          />
          <label className="grid gap-1 text-sm">
            Time
            <Input type="time" value={form.time} onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))} />
          </label>
          <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
            {preview}
          </p>
          {error !== null ? (
            <p role="alert" className="text-sm text-[color:var(--tg-failed)]">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={error !== null}>
              Snooze
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

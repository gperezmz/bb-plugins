// The list's one drag: one dnd-kit draggable for every row and group header,
// which a press sets to what was pressed, and targets found from the list's
// positions rather than droppables, so a row that is not mounted is a target
// once scrolling brings it under the pointer. dnd-kit keeps its 4 px
// activation and its auto-scroll near the list's edges. No key starts a drag.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject, type SyntheticEvent } from "react";
import { DndContext, MouseSensor, TouchSensor, useDraggable, useSensor, useSensors, type DragStartEvent } from "@dnd-kit/core";
import type { Dragged } from "../../commands/commands";
import { targetAt, type PointedTarget } from "../../model/drag";
import type { ListItems } from "../../model/layout-items";
import type { Dragging } from "../../store/api";
import { useCommands, useLayout } from "../../store/hooks";

// Constant, so dnd-kit's sensors, and with them its context, stay put.
const MOUSE_SENSOR = { activationConstraint: { distance: 4 } };
const TOUCH_SENSOR = { activationConstraint: { delay: 200, tolerance: 6 } };
const DRAGGABLE_ID = "thread-glance-list";

/** A list surface drawn from positions: the main list, or the More popover's. */
interface Surface {
  root: RefObject<HTMLElement | null>;
  layout: { current: ListItems };
}

interface DragApi {
  register(surface: Surface): () => void;
  /** The sensors' press handlers, for a surface to put on its root. */
  listeners: Record<string, (event: SyntheticEvent) => void>;
  setNode(node: HTMLElement | null): void;
}

const DragContext = createContext<DragApi | null>(null);

/** What a press on `target` would drag, read off the row or header it is in. */
export function pressedAt(target: EventTarget | null): { dragged: Dragged; dragging: Dragging } | null {
  if (!(target instanceof Element)) return null;
  if (target.closest("[data-no-drag], input, textarea") !== null) return null;
  const row = target.closest<HTMLElement>("[data-drag-thread]");
  if (row !== null) {
    const { dragThread, dragParent, dragSection, dragPinned, dragGroup, dragRow } = row.dataset;
    return {
      dragged: {
        kind: "thread",
        thread: { threadId: dragThread!, parentThreadId: dragParent || null, sectionId: dragSection || null, pinned: dragPinned === "true" },
      },
      dragging: { kind: "thread", threadId: dragThread!, groupId: dragGroup!, rowKey: dragRow! },
    };
  }
  const header = target.closest<HTMLElement>("[data-drag-group]");
  if (header !== null) {
    const groupId = header.dataset.dragGroup!;
    return { dragged: { kind: "group", groupId }, dragging: { kind: "group", groupId } };
  }
  return null;
}

export function DragLayer({ children }: { children: ReactNode }) {
  const commands = useCommands();
  const { compact } = useLayout();
  const mouse = useSensor(MouseSensor, MOUSE_SENSOR);
  const touch = useSensor(TouchSensor, TOUCH_SENSOR);
  // Phones have no drag.
  const sensors = useSensors(...(compact ? [] : [mouse, touch]));
  const surfaces = useRef(new Set<Surface>());
  const pressed = useRef<{ dragged: Dragged; dragging: Dragging } | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const pointed = useRef<PointedTarget>({ target: null, placement: "before" });

  /** The target under the last pointer position, over whichever surface it is on. */
  const aim = useCallback(() => {
    const at = pointer.current;
    const dragged = pressed.current?.dragged;
    if (at === null || dragged === undefined) return;
    let next: PointedTarget = { target: null, placement: "before" };
    for (const surface of surfaces.current) {
      const root = surface.root.current;
      if (root === null) continue;
      const box = root.getBoundingClientRect();
      if (at.x < box.left || at.x > box.right || at.y < box.top || at.y > box.bottom) continue;
      next = targetAt(surface.layout.current, at.y - box.top, dragged.kind);
      break;
    }
    pointed.current = next;
    commands.dragOver(dragged, next.target);
  }, [commands]);

  useEffect(() => {
    const track = (event: MouseEvent | TouchEvent) => {
      if (pressed.current === null) return;
      const point = "touches" in event ? event.touches[0] : event;
      if (point !== undefined) pointer.current = { x: point.clientX, y: point.clientY };
    };
    document.addEventListener("mousemove", track, true);
    document.addEventListener("touchmove", track, true);
    return () => {
      document.removeEventListener("mousemove", track, true);
      document.removeEventListener("touchmove", track, true);
    };
  }, []);

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      const start = pressed.current;
      if (start === null) return;
      const activator = event.activatorEvent;
      if (activator instanceof MouseEvent) pointer.current = { x: activator.clientX, y: activator.clientY };
      commands.dragStart(start.dragging);
      // Auto-scroll brings rows under a still pointer: they are targets too.
      document.addEventListener("scroll", aim, true);
      aim();
    },
    [aim, commands],
  );
  const finish = useCallback(
    (drop: boolean) => {
      document.removeEventListener("scroll", aim, true);
      const start = pressed.current;
      pressed.current = null;
      if (!drop || start === null) {
        commands.dragCancel();
        return;
      }
      aim();
      commands.drop(start.dragged, pointed.current.target, pointed.current.placement);
    },
    [aim, commands],
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragMove={aim}
      onDragEnd={() => finish(true)}
      onDragCancel={() => finish(false)}
    >
      <Draggable pressed={pressed} surfaces={surfaces} disabled={compact}>
        {children}
      </Draggable>
    </DndContext>
  );
}

/** The one draggable, whose press handlers go on each surface's root. */
function Draggable({
  pressed,
  surfaces,
  disabled,
  children,
}: {
  pressed: { current: { dragged: Dragged; dragging: Dragging } | null };
  surfaces: { current: Set<Surface> };
  disabled: boolean;
  children: ReactNode;
}) {
  const draggable = useDraggable({ id: DRAGGABLE_ID, disabled });
  const sensorListeners = draggable.listeners;
  // A press sets what is dragged; one on anything that is not a row or a
  // header, or on a row's buttons, starts nothing.
  const listeners = useMemo(() => {
    const wrapped: Record<string, (event: SyntheticEvent) => void> = {};
    for (const [name, listener] of Object.entries(sensorListeners ?? {})) {
      wrapped[name] = (event) => {
        const press = pressedAt(event.target);
        if (press === null) return;
        pressed.current = press;
        (listener as (event: SyntheticEvent) => void)(event);
      };
    }
    return wrapped;
  }, [sensorListeners, pressed]);
  const api = useMemo<DragApi>(
    () => ({
      register(surface) {
        surfaces.current.add(surface);
        return () => surfaces.current.delete(surface);
      },
      listeners,
      setNode: draggable.setNodeRef,
    }),
    [listeners, surfaces, draggable.setNodeRef],
  );
  return <DragContext.Provider value={api}>{children}</DragContext.Provider>;
}

/**
 * Makes `root` a drag surface: presses on its rows and headers start the
 * list's drag, and the pointer over it finds targets in `layout`. The main
 * list's root is also the draggable's node, whose scroll area auto-scrolls.
 */
export function useDragSurface(root: RefObject<HTMLElement | null>, layout: ListItems, main: boolean): DragApi["listeners"] {
  const api = useContext(DragContext);
  const current = useRef(layout);
  current.current = layout;
  useLayoutEffect(() => {
    if (api === null) return;
    const unregister = api.register({ root, layout: current });
    if (main) api.setNode(root.current);
    return () => {
      unregister();
      if (main) api.setNode(null);
    };
  }, [api, root, main]);
  return api?.listeners ?? NO_LISTENERS;
}

const NO_LISTENERS: DragApi["listeners"] = {};

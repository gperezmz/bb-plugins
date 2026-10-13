import { Glyph, ServiceLogo } from "../look/Glyph";
import { ICONS, SERVICE_NAMES, type Service } from "../look/icons";

/**
 * A choice of service as tiles, each with its logo and name, the chosen one marked. Each tile is a radio button, so
 * the choice reads and moves like one. A service with no logo to show is its name alone.
 */
export function ServiceTiles({ legend, name, services, chosen, onChoose }: { legend: string; name: string; services: readonly Service[]; chosen: Service | null; onChoose(service: Service): void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-medium">{legend}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {services.map((service) => (
          <label
            key={service}
            className="relative flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-border p-3 hover:bg-state-hover has-[:checked]:border-foreground has-[:checked]:bg-state-active has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-ring"
          >
            <input type="radio" name={name} value={service} checked={chosen === service} onChange={() => onChoose(service)} className="sr-only" />
            <ServiceLogo service={service} decorative logoOnly className="size-6" />
            <span className="font-medium">{SERVICE_NAMES[service]}</span>
            {chosen === service ? <Glyph name={ICONS.done} className="absolute right-1.5 top-1.5" /> : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

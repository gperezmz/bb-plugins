// The logos of GitLab, Jira and Linear, each the brand's own artwork in its own colours, drawn as inline SVG since bb
// paints an icon it draws in the current text colour. This file is the one place in the plugin's interface that names
// colours of its own: brand artwork, an exception to the rule that every colour is one of bb's theme tokens
// (`tones.test.ts` exempts it by name). Each mark's shapes and fills are copied from the file its owner publishes, as
// `THIRD_PARTY_NOTICES.md` lists; the only changes are a `viewBox` cropped to GitLab's mark, which the file draws with
// clear space of its own that would leave the mark a few pixels wide at the size the plugin draws logos, and the id of
// Jira's clip path, made unique to each drawing since a page holds many.
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Service } from "./icons";

interface Artwork {
  /** What the brand's file draws, as the paths and groups inside its `<svg>`; `id` is unique to the drawing, for the ids the file refers to itself by. */
  readonly draw: (id: string) => ReactNode;
  readonly viewBox: string;
}

const LINEAR_MARK =
  "M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1782c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3075.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624ZM4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99132 1.6684-1.88843 3.3994-2.68399 5.1855ZM12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3903.3487-.984.3258-1.3542-.0443L12.6587 18.074Z";

/** GitLab's logomark, `gitlab-logo-500-rgb.svg` of its press kit, cropped to the mark. */
const GITLAB: Artwork = {
  viewBox: "112.13 115 155.74 150",
  draw: () => (
    <>
      <path
        fill="#e24329"
        d="M265.26416,174.37243l-.2134-.55822-21.19899-55.30908c-.4236-1.08359-1.18542-1.99642-2.17699-2.62689-.98837-.63373-2.14749-.93253-3.32305-.87014-1.1689.06239-2.29195.48925-3.20809,1.21821-.90957.73554-1.56629,1.73047-1.87493,2.85346l-14.31327,43.80662h-57.90965l-14.31327-43.80662c-.30864-1.12299-.96536-2.11791-1.87493-2.85346-.91614-.72895-2.03911-1.15582-3.20809-1.21821-1.17548-.06239-2.33468.23641-3.32297.87014-.99166.63047-1.75348,1.5433-2.17707,2.62689l-21.19891,55.31237-.21348.55493c-6.28158,16.38521-.92929,34.90803,13.05891,45.48782.02621.01641.04922.03611.07552.05582l.18719.14119,32.29094,24.17392,15.97151,12.09024,9.71951,7.34871c2.34117,1.77316,5.57877,1.77316,7.92002,0l9.71943-7.34871,15.96822-12.09024,32.48142-24.31511c.02958-.02299.05588-.04269.08538-.06568,13.97834-10.57977,19.32735-29.09604,13.04905-45.47796Z"
      />
      <path
        fill="#fc6d26"
        d="M265.26416,174.37243l-.2134-.55822c-10.5174,2.16062-20.20405,6.6099-28.49844,12.81593-.1346.0985-25.20497,19.05805-46.55171,35.19699,15.84998,11.98517,29.6477,22.40405,29.6477,22.40405l32.48142-24.31511c.02958-.02299.05588-.04269.08538-.06568,13.97834-10.57977,19.32735-29.09604,13.04905-45.47796Z"
      />
      <path
        fill="#fca326"
        d="M160.34962,244.23117l15.97151,12.09024,9.71951,7.34871c2.34117,1.77316,5.57877,1.77316,7.92002,0l9.71943-7.34871,15.96822-12.09024s-13.79772-10.41888-29.6477-22.40405c-15.85327,11.98517-29.65099,22.40405-29.65099,22.40405Z"
      />
      <path
        fill="#fc6d26"
        d="M143.44561,186.63014c-8.29111-6.20274-17.97446-10.65531-28.49507-12.81264l-.21348.55493c-6.28158,16.38521-.92929,34.90803,13.05891,45.48782.02621.01641.04922.03611.07552.05582l.18719.14119,32.29094,24.17392s13.79772-10.41888,29.65099-22.40405c-21.34673-16.13894-46.42031-35.09848-46.55499-35.19699Z"
      />
    </>
  ),
};

/** Jira's icon, `Jira_icon.svg` of Atlassian's logo library: its blue tile and white mark, which read on either theme. */
const JIRA: Artwork = {
  viewBox: "0 0 48 48",
  draw: (id) => (
    <>
      <path d="M0 12C0 5.37258 5.37258 0 12 0H36C42.6274 0 48 5.37258 48 12V36C48 42.6274 42.6274 48 36 48H12C5.37258 48 0 42.6274 0 36V12Z" fill="#1868DB" />
      <g clipPath={`url(#${id})`}>
        <path
          d="M17.9475 31.0469H15.2429C11.1638 31.0469 8.23755 28.5484 8.23755 24.8899H22.7804C23.5341 24.8899 24.0218 25.4252 24.0218 26.1837V40.8178C20.3861 40.8178 17.9475 37.8731 17.9475 33.7684V31.0469ZM25.1303 23.7745H22.4257C18.3466 23.7745 15.4203 21.3206 15.4203 17.6621H29.9631C30.7168 17.6621 31.2489 18.1528 31.2489 18.9113V33.5454C27.6132 33.5454 25.1303 30.6007 25.1303 26.496V23.7745ZM32.3573 16.5467H29.6527C25.5736 16.5467 22.6473 14.0482 22.6473 10.3896H37.1902C37.9439 10.3896 38.4316 10.925 38.4316 11.6389V26.273C34.7959 26.273 32.3573 23.3283 32.3573 19.2236V16.5467Z"
          fill="white"
        />
      </g>
      <defs>
        <clipPath id={id}>
          <rect width="30.1941" height="30.4281" fill="white" transform="translate(8.23755 10.3901)" />
        </clipPath>
      </defs>
    </>
  ),
};

/** Linear's mark in the colour its `logo-dark.svg` draws it, for a light page. */
const LINEAR_ON_LIGHT: Artwork = { viewBox: "0 0 100 100", draw: () => <path fill="#222326" d={LINEAR_MARK} /> };

/** Linear's mark in the colour its `logo-light.svg` draws it, for a dark page. */
const LINEAR_ON_DARK: Artwork = { viewBox: "0 0 100 100", draw: () => <path fill="#fff" d={LINEAR_MARK} /> };

/** One brand's artwork for a light page and, where it publishes one, for a dark page. */
export interface BrandArtwork {
  readonly light: Artwork;
  readonly dark?: Artwork;
}

/**
 * The artwork of each service whose logo is a brand's own, on a light page and, for a brand that publishes a version
 * for dark backgrounds, on a dark one. GitLab's press kit offers its mark in full colour and in one colour for where a
 * page is limited to one; the full colour reads on a dark page, so it is the one drawn there. GitHub's logo is bb's.
 */
export const BRAND_ARTWORK: Readonly<Record<Exclude<Service, "github">, BrandArtwork>> = {
  gitlab: { light: GITLAB },
  jira: { light: JIRA },
  linear: { light: LINEAR_ON_LIGHT, dark: LINEAR_ON_DARK },
};

function Drawing({ artwork, className }: { artwork: Artwork; className?: string }) {
  const id = `unattendish-${useId().replace(/:/g, "")}`;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={artwork.viewBox} aria-hidden="true" focusable="false" className={cn("size-full", className)}>
      {artwork.draw(id)}
    </svg>
  );
}

/**
 * A brand's artwork, to fill the box of a logo: the light version, and, where the brand has a dark one, the dark version
 * where bb's `.dark` class is set (Tailwind's `dark:` variant follows the operating system instead) in its place.
 */
export function BrandDrawing({ artwork: { light, dark } }: { artwork: BrandArtwork }) {
  return (
    <>
      <Drawing artwork={light} className={dark !== undefined ? "[.dark_&]:hidden" : undefined} />
      {dark !== undefined ? <Drawing artwork={dark} className="hidden [.dark_&]:block" /> : null}
    </>
  );
}

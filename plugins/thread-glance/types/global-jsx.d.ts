// @dnd-kit's declarations name the global JSX namespace, which React 19's
// types no longer declare. Alias it to React's so the library typechecks.
import type { JSX as ReactJSX } from "react";

declare global {
  namespace JSX {
    type Element = ReactJSX.Element;
    type IntrinsicElements = ReactJSX.IntrinsicElements;
  }
}

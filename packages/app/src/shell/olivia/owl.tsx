import type { JSX } from "solid-js"

/**
 * The oliviacode mark.
 *
 * One faceted owl, drawn on a 256 grid so every size lands on whole pixels: the shield
 * silhouette, the brow chevron, two monospaced eyes, and a diamond beak. `tone="mono"`
 * drops the two inner facet fills to one colour, which is what the titlebar and the
 * installer icon want; `tone="brand"` keeps the violet gradient.
 *
 * The geometry is deliberately sharper than the wordmark: at 16px the eyes still resolve,
 * and at 128px the facets read as a cut gem. No strokes: every edge is a filled polygon,
 * so the mark stays crisp at fractional device pixel ratios.
 */
export function OwlMark(props: { size?: number; tone?: "brand" | "mono"; class?: string }) {
  const size = () => props.size ?? 24
  const mono = () => props.tone === "mono"

  return (
    <svg
      viewBox="0 0 256 256"
      width={size()}
      height={size()}
      class={props.class}
      role="img"
      aria-label="oliviacode"
      data-slot="owl-mark"
      data-tone={props.tone ?? "brand"}
    >
      {/* Silhouette: ears at the top corners, cheeks flaring, chin on the baseline. */}
      <path
        d="M128 8 L40 34 L16 92 L30 172 L70 216 L128 250 L186 216 L226 172 L240 92 L216 34 Z"
        fill={mono() ? "currentColor" : "#1a1333"}
      />
      {!mono() && (
        <>
          {/* Left cheek facet: the darker half of the face, lit from the right. */}
          <path d="M40 34 L16 92 L30 172 L70 216 L128 250 L128 128 Z" fill="#241a4d" opacity="0.9" />
          {/* Right cheek facet. */}
          <path d="M216 34 L240 92 L226 172 L186 216 L128 250 L128 128 Z" fill="#150f28" />
        </>
      )}
      {/* Brow: one violet chevron from ear to ear, the widest bright shape in the mark. */}
      <path
        d="M40 34 L128 96 L216 34 L196 84 L128 128 L60 84 Z"
        fill={mono() ? "currentColor" : "url(#owl-brow)"}
        opacity={mono() ? "0.55" : "1"}
      />
      {/* Beak: a diamond that runs to the chin, split by a darker midline. */}
      <path d="M128 128 L150 168 L128 240 L106 168 Z" fill="currentColor" opacity={mono() ? "0.75" : "1"} />
      {!mono() && <path d="M128 128 L128 240 L106 168 Z" fill="#3a2691" opacity="0.55" />}
      {/* Eyes: `<` and `>`, white, chunky, the same glyph the app uses for prompts. */}
      <path d="M96 132 L64 164 L96 196 L96 178 L82 164 L96 150 Z" fill="#f4f1ff" />
      <path d="M160 132 L192 164 L160 196 L160 178 L174 164 L160 150 Z" fill="#f4f1ff" />
      {!mono() && (
        <defs>
          <linearGradient id="owl-brow" x1="40" y1="34" x2="216" y2="128" gradientUnits="userSpaceOnUse">
            <stop offset="0" stop-color="#9a6bff" />
            <stop offset="0.5" stop-color="#7c4dff" />
            <stop offset="1" stop-color="#5b2bd9" />
          </linearGradient>
        </defs>
      )}
    </svg>
  )
}

/** The eyes alone, for a working indicator that is not a spinner. */
export function OwlEyes(props: { size?: number; class?: string }) {
  const size = () => props.size ?? 16

  return (
    <svg
      viewBox="0 0 64 32"
      width={size() * 2}
      height={size()}
      class={props.class}
      aria-hidden="true"
      data-slot="owl-eyes"
    >
      <path d="M22 6 L8 18 L22 30 L22 23 L16 18 L22 13 Z" fill="currentColor" />
      <path d="M42 6 L56 18 L42 30 L42 23 L48 18 L42 13 Z" fill="currentColor" />
    </svg>
  )
}

/**
 * The send glyph: two upward chevrons, the owl's brow repeated.
 *
 * Every chat app ships an arrow in this seat; the pair is what makes the composer
 * read as this app at a glance. Filled polygons, not strokes, so it stays crisp at 16px.
 */
export function OwlSend(props: { size?: number; class?: string }) {
  const size = () => props.size ?? 16

  return (
    <svg
      viewBox="0 0 24 24"
      width={size()}
      height={size()}
      class={props.class}
      fill="currentColor"
      aria-hidden="true"
      data-slot="owl-send"
    >
      <path d="M4.5 14 L8 10.5 L11.5 14 L11.5 11.8 L8 8.3 L4.5 11.8 Z" />
      <path d="M12.5 14 L16 10.5 L19.5 14 L19.5 11.8 L16 8.3 L12.5 11.8 Z" />
    </svg>
  )
}

/**
 * Mark plus wordmark, for the sidebar header and the About panel.
 *
 * The wordmark is set, not drawn: one weight, wide tracking, uppercase. Drawing it as
 * paths would freeze the typeface for every future size; setting it means the same string
 * can shrink to 11px in the titlebar without a second asset.
 */
export function OwlLockup(props: { size?: number; class?: string }): JSX.Element {
  const size = () => props.size ?? 22

  return (
    <span class={props.class} data-slot="owl-lockup" style={{ display: "inline-flex", "align-items": "center", gap: "8px" }}>
      <OwlMark size={size()} />
      <span
        style={{
          "font-family": "var(--owl-font-display)",
          "font-size": `${Math.round(size() * 0.66)}px`,
          "font-weight": "700",
          "letter-spacing": "0.14em",
          "text-transform": "uppercase",
          "line-height": "1",
          color: "currentColor",
        }}
      >
        oliviacode
      </span>
    </span>
  )
}

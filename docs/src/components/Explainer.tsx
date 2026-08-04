import { EXPLAINERS, type Figure, type LineCell } from "../data/explainers";
import { useWalkthrough } from "./useWalkthrough";

/**
 * A stepped, animated explainer for the behaviours prose describes badly.
 *
 * Same shell as the pipeline walkthrough on the architecture page, and the same
 * rules about autoplay, pausing and reduced motion, which now live in
 * `useWalkthrough`. What differs is the drawing: instead of one bespoke view
 * per stage, a step names a figure and this renders it.
 *
 * Three figures cover everything the documentation has needed so far. `lines`
 * is a document with a state per line, which is how caching, incremental
 * re-evaluation and pending values all want to be shown. `flow` is a sequence
 * of boxes with some struck through. `chips` is a row of labelled tokens.
 */

function howManyBeats(figure: Figure): number {
  switch (figure.kind) {
    case "lines":
      return figure.lines.length;
    case "flow":
      return figure.nodes.length;
    case "chips":
      return figure.chips.length;
  }
}

function LinesFigure({ lines, revealed }: { lines: LineCell[]; revealed: number }) {
  return (
    <ol className="xp__lines">
      {lines.map((line, index) => (
        <li
          key={index}
          className="xp__line"
          data-state={line.state}
          data-shown={index < revealed}
        >
          <span className="xp__line-number">{index + 1}</span>
          <span className="xp__line-text">{line.text}</span>
          <span className="xp__line-value">{line.value ?? ""}</span>
          <span className="xp__line-tag">{line.tag ?? ""}</span>
        </li>
      ))}
    </ol>
  );
}

function Explainer({ id }: { id: string }) {
  const explainer = EXPLAINERS[id];
  if (!explainer) {
    throw new Error(
      `No explainer named "${id}". Add it to src/data/explainers.ts, or fix the id.`,
    );
  }

  const { steps } = explainer;
  const walkthrough = useWalkthrough({
    stepCount: steps.length,
    beatsFor: (index) => howManyBeats(steps[index].figure),
  });
  const { step, revealed, playing, inView, reduced, rootRef, goTo, takeOver, setPlaying } =
    walkthrough;

  const current = steps[step];
  const figure = current.figure;

  return (
    <div className="xp not-content" ref={rootRef}>
      <ol className="xp__rail">
        {steps.map((entry, index) => (
          <li key={entry.title}>
            <button
              type="button"
              className="xp__step"
              aria-current={index === step ? "step" : undefined}
              data-state={index < step ? "done" : index === step ? "current" : "ahead"}
              onClick={() => takeOver(() => goTo(index))}
            >
              <span className="xp__step-index">{index + 1}</span>
              <span className="xp__step-title">{entry.title}</span>
              <span className="xp__step-summary">{entry.summary}</span>
            </button>
            {index === step && playing && inView && !reduced && (
              <span className="xp__progress" aria-hidden="true" />
            )}
          </li>
        ))}
      </ol>

      <div className="xp__viewport" role="region" aria-live="polite" aria-label={current.title}>
        {figure.kind === "lines" && <LinesFigure lines={figure.lines} revealed={revealed} />}

        {figure.kind === "flow" && (
          <ol className="xp__flow" data-direction={figure.direction ?? "row"}>
            {figure.nodes.map((node, index) => (
              <li
                key={node.label}
                className="xp__node"
                data-shown={index < revealed}
                data-active={node.active || undefined}
                data-skipped={node.skipped || undefined}
              >
                <span className="xp__node-label">{node.label}</span>
                {node.detail && <span className="xp__node-detail">{node.detail}</span>}
              </li>
            ))}
          </ol>
        )}

        {figure.kind === "chips" && (
          <div className="xp__chips-wrap">
            <ol className="xp__chips">
              {figure.chips.map((chip, index) => (
                <li
                  key={`${chip.text}-${index}`}
                  className="xp__chip"
                  data-shown={index < revealed}
                  data-changed={chip.changed || undefined}
                >
                  <span className={chip.className ? `xp__chip-text ${chip.className}` : "xp__chip-text"}>
                    {chip.text}
                  </span>
                  {chip.label && <span className="xp__chip-label">{chip.label}</span>}
                </li>
              ))}
            </ol>
            {figure.caption && <p className="xp__caption">{figure.caption}</p>}
          </div>
        )}

        <p className="xp__note">{current.note}</p>
      </div>

      <div className="xp__controls">
        <span className="xp__eyebrow">{explainer.eyebrow}</span>
        <div className="xp__buttons">
          <button
            type="button"
            className="xp__control"
            onClick={() => takeOver(() => goTo(step - 1))}
          >
            Back
          </button>
          {!reduced && (
            <button
              type="button"
              className="xp__control"
              aria-pressed={playing}
              onClick={() => setPlaying(!playing)}
            >
              {playing ? "Pause" : "Play"}
            </button>
          )}
          <button
            type="button"
            className="xp__control"
            onClick={() => takeOver(() => goTo(step + 1))}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

export default Explainer;

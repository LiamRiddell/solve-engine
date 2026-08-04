import { useEffect, useRef, useState } from "react";
import { useWalkthrough } from "./useWalkthrough";
import {
  EXAMPLES,
  STAGES,
  type Instruction,
  type PipelineExample,
  type TreeNode,
} from "../data/pipelineStages";

/**
 * An animated walk of one expression through all five pipeline stages.
 *
 * ## Why it animates
 *
 * The pipeline's whole argument is that each stage hands on a different shape
 * from the one it received. A static diagram can only assert that. Showing the
 * same expression become tokens, then fewer tokens, then a tree, then a flat
 * program, then a stack that collapses to one value, demonstrates it.
 *
 * Autoplay exists so the page explains itself to someone who does nothing, and
 * stops the moment someone takes over: hovering, focusing, or using any control
 * pauses it, because an animation that keeps moving while you are reading it is
 * worse than no animation.
 *
 * `prefers-reduced-motion` turns all of it off. There is no autoplay and no
 * transition, and every stage is reachable with the same controls.
 */

/** How long each stage holds before autoplay advances, in milliseconds. */
const STAGE_MS = 5200;

/** How long between the pieces of one stage arriving, in milliseconds. */
const BEAT_MS = 90;

/** The expression, with the span the current token came from picked out. */
function SourceLine({
  expression,
  from,
  to,
}: {
  expression: string;
  from: number;
  to: number;
}) {
  return (
    <p className="pw__source" aria-hidden="true">
      <span>{expression.slice(0, from)}</span>
      <span className="pw__source-hit">{expression.slice(from, to)}</span>
      <span>{expression.slice(to)}</span>
    </p>
  );
}

function LexingStage({
  example,
  revealed,
}: {
  example: PipelineExample;
  revealed: number;
}) {
  const current = example.lexed[Math.min(revealed, example.lexed.length) - 1];

  return (
    <div className="pw__stage">
      <SourceLine
        expression={example.expression}
        from={current?.from ?? 0}
        to={current?.to ?? 0}
      />
      <ol className="pw__tokens">
        {example.lexed.map((token, index) => (
          <li
            key={`${token.type}-${index}`}
            className="pw__token"
            data-shown={index < revealed}
          >
            <span className={`pw__token-text solve-${token.category}`}>{token.text}</span>
            <span className="pw__token-type">{token.type}</span>
          </li>
        ))}
      </ol>
      <p className="pw__note">
        The lexer is vocabulary-driven, so a package adds a keyword, an operator
        or a unit without this stage being edited. Every chip above is one token
        with a type and the span of source it came from.
      </p>
    </div>
  );
}

function NormalisationStage({
  example,
  revealed,
}: {
  example: PipelineExample;
  revealed: number;
}) {
  return (
    <div className="pw__stage">
      <ol className="pw__tokens pw__tokens--before">
        {example.lexed.map((token, index) => (
          <li key={`${token.type}-${index}`} className="pw__token" data-shown={true}>
            <span className={`pw__token-text solve-${token.category}`}>{token.text}</span>
            <span className="pw__token-type">{token.type}</span>
          </li>
        ))}
      </ol>

      <p className="pw__arrow" aria-hidden="true">
        ↓
      </p>

      <ol className="pw__tokens">
        {example.normalised.map((token, index) => (
          <li
            key={`${token.type}-${index}`}
            className="pw__token"
            data-shown={index < revealed}
            data-change={token.change ?? undefined}
          >
            <span className={`pw__token-text solve-${token.category}`}>{token.text}</span>
            <span className="pw__token-type">{token.type}</span>
          </li>
        ))}
      </ol>

      <p className="pw__note">{example.normalisationNote}</p>
    </div>
  );
}

/** Renders the parse tree as nested lists, which is what it actually is. */
function TreeBranch({ node, depth }: { node: TreeNode; depth: number }) {
  return (
    <li className="pw__branch" style={{ "--pw-depth": depth } as React.CSSProperties}>
      <div className="pw__node">
        <span className="pw__node-label">{node.label}</span>
        {node.detail && <span className="pw__node-detail">{node.detail}</span>}
      </div>
      {node.children && node.children.length > 0 && (
        <ol className="pw__children">
          {node.children.map((child, index) => (
            <TreeBranch key={`${child.label}-${index}`} node={child} depth={depth + 1} />
          ))}
        </ol>
      )}
    </li>
  );
}

function ParsingStage({ example }: { example: PipelineExample }) {
  return (
    <div className="pw__stage">
      <ol className="pw__tree">
        <TreeBranch node={example.tree} depth={0} />
      </ol>
      <p className="pw__note">{example.parseNote}</p>
    </div>
  );
}

function CompilationStage({
  example,
  revealed,
}: {
  example: PipelineExample;
  revealed: number;
}) {
  const label = (instruction: Instruction) =>
    instruction.operand === undefined
      ? instruction.op
      : `${instruction.op} ${instruction.operand}`;

  return (
    <div className="pw__stage pw__stage--split">
      <div>
        <h4 className="pw__label">Code</h4>
        <ol className="pw__code">
          {example.code.map((instruction, index) => (
            <li key={index} className="pw__instruction" data-shown={index < revealed}>
              <span className="pw__instruction-index">{index}</span>
              <span className="pw__instruction-op">{label(instruction)}</span>
              <span className="pw__instruction-comment">{instruction.comment}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="pw__pools">
        <div>
          <h4 className="pw__label">Number pool</h4>
          <ol className="pw__pool">
            {example.numbers.map((value, index) => (
              <li key={index}>
                <span className="pw__pool-index">{index}</span>
                <span>{value}</span>
              </li>
            ))}
          </ol>
        </div>

        <div>
          <h4 className="pw__label">String pool</h4>
          {example.strings.length === 0 ? (
            <p className="pw__pool-empty">empty</p>
          ) : (
            <ol className="pw__pool">
              {example.strings.map((value, index) => (
                <li key={index}>
                  <span className="pw__pool-index">{index}</span>
                  <span>{value}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <p className="pw__note pw__note--full">{example.compileNote}</p>
    </div>
  );
}

function ExecutionStage({
  example,
  revealed,
}: {
  example: PipelineExample;
  revealed: number;
}) {
  const step = example.steps[Math.max(0, Math.min(revealed, example.steps.length) - 1)];
  const finished = revealed >= example.steps.length;

  return (
    <div className="pw__stage pw__stage--split">
      <div>
        <h4 className="pw__label">Instructions</h4>
        <ol className="pw__code">
          {example.steps.map((entry, index) => (
            <li
              key={index}
              className="pw__instruction"
              data-shown={true}
              data-state={
                index < revealed - 1 ? "done" : index === revealed - 1 ? "current" : "ahead"
              }
            >
              <span className="pw__instruction-index">{index}</span>
              <span className="pw__instruction-op">{entry.instruction}</span>
            </li>
          ))}
        </ol>
      </div>

      <div>
        <h4 className="pw__label">Stack</h4>
        <ol className="pw__stack">
          {(step?.stack ?? []).map((cell, index) => (
            <li key={`${cell}-${index}`} className="pw__cell">
              {cell}
            </li>
          ))}
        </ol>
        <p className="pw__step-note">{step?.note}</p>
      </div>

      <p className="pw__note pw__note--full">
        {finished ? (
          <>
            One value left on the stack, and it is the answer:{" "}
            <b className="pw__answer">{example.answer}</b>. Every instruction above also
            checked the instruction budget and the stack depth before it ran.
          </>
        ) : (
          <>
            The stack holds values, not raw numbers, so a unit, an error or a pending
            state survives an operation rather than being flattened into a number.
          </>
        )}
      </p>
    </div>
  );
}

/** How many pieces the given stage reveals one at a time. */
function beatsFor(example: PipelineExample, stage: number): number {
  switch (stage) {
    case 0:
      return example.lexed.length;
    case 1:
      return example.normalised.length;
    case 3:
      return example.code.length;
    case 4:
      return example.steps.length;
    default:
      return 1;
  }
}

export default function PipelineWalkthrough() {
  const [exampleIndex, setExampleIndex] = useState(0);
  const example = EXAMPLES[exampleIndex];

  const {
    step: stage,
    revealed,
    playing,
    inView,
    reduced,
    rootRef,
    goTo: goToStage,
    takeOver,
    setPlaying,
  } = useWalkthrough({
    stepCount: STAGES.length,
    beatsFor: (index) => beatsFor(example, index),
    stageMs: STAGE_MS,
    beatMs: BEAT_MS,
    resetKey: exampleIndex,
  });

  const stageMeta = STAGES[stage];
  const railRef = useRef<HTMLOListElement>(null);

  // On a phone the rail is a scrolling strip rather than five equal columns, so
  // advancing to a stage that is off to the right would otherwise look like
  // nothing happened.
  useEffect(() => {
    const current = railRef.current?.children[stage] as HTMLElement | undefined;
    current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [stage]);

  return (
    <div className="pw not-content" ref={rootRef}>
      <div className="pw__head">
        <div
          className="pw__examples"
          role="tablist"
          aria-label="Example expression"
        >
          {EXAMPLES.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              role="tab"
              aria-selected={index === exampleIndex}
              className="pw__example"
              onClick={() =>
                takeOver(() => {
                  setExampleIndex(index);
                  goToStage(0);
                })
              }
            >
              {candidate.expression}
            </button>
          ))}
        </div>
        <p className="pw__blurb">{example.blurb}</p>
      </div>

      <ol className="pw__rail" ref={railRef}>
        {STAGES.map((entry, index) => (
          <li key={entry.id}>
            <button
              type="button"
              className="pw__step"
              aria-current={index === stage ? "step" : undefined}
              data-state={index < stage ? "done" : index === stage ? "current" : "ahead"}
              onClick={() => takeOver(() => goToStage(index))}
            >
              <span className="pw__step-index">{index + 1}</span>
              <span className="pw__step-title">{entry.title}</span>
              <span className="pw__step-summary">{entry.summary}</span>
            </button>
            {index === stage && playing && inView && !reduced && (
              <span
                className="pw__progress"
                style={{ animationDuration: `${STAGE_MS}ms` }}
                aria-hidden="true"
              />
            )}
          </li>
        ))}
      </ol>

      <div className="pw__viewport" role="region" aria-live="polite" aria-label={stageMeta.title}>
        {stage === 0 && <LexingStage example={example} revealed={revealed} />}
        {stage === 1 && <NormalisationStage example={example} revealed={revealed} />}
        {stage === 2 && <ParsingStage example={example} />}
        {stage === 3 && <CompilationStage example={example} revealed={revealed} />}
        {stage === 4 && <ExecutionStage example={example} revealed={revealed} />}
      </div>

      <div className="pw__controls">
        <button
          type="button"
          className="pw__control"
          onClick={() => takeOver(() => goToStage(stage - 1))}
        >
          Previous stage
        </button>
        {!reduced && (
          <button
            type="button"
            className="pw__control"
            aria-pressed={playing}
            onClick={() => setPlaying((current) => !current)}
          >
            {playing ? "Pause" : "Play"}
          </button>
        )}
        <button
          type="button"
          className="pw__control"
          onClick={() => takeOver(() => goToStage(stage + 1))}
        >
          Next stage
        </button>
      </div>
    </div>
  );
}

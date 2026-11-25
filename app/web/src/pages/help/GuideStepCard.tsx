/** One numbered step of the "How to use" walkthrough: where it is, what you see, what to do, what the numbers mean. */
import { MaskIcon } from "../../ui/MaskIcon";
import type { GuideStep } from "./guide";

export function GuideStepCard({ n, step }: { n: number; step: GuideStep }) {
  return (
    <section id={`step-${n}`} className="card card--lg help-step" aria-labelledby={`step-${n}-title`}>
      <header className="help-step__head">
        <span className="help-step__num" aria-hidden>
          {n}
        </span>
        <div className="help-step__name">
          <h2 id={`step-${n}-title`} className="help__h2">
            <span className="sr-only">Step {n}: </span>
            {step.title}
          </h2>
          <span className="muted help-step__where">
            {step.icon && <MaskIcon src={step.icon} className="help-step__icon" />}
            {step.where}
          </span>
        </div>
        {step.go.map((g) => (
          <a key={g.route} className="btn btn--pill btn--primary" href={`#/${g.route}`}>
            Go to {g.label} <span aria-hidden>→</span>
          </a>
        ))}
      </header>
      <div className="help-step__body">
        <div>
          <h3 className="caps">What you see</h3>
          {step.see.map((t) => (
            <p key={t}>{t}</p>
          ))}
        </div>
        <div>
          <h3 className="caps">What to do</h3>
          <ul>
            {step.todo.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
        {step.numbers && (
          <div>
            <h3 className="caps">What the numbers mean</h3>
            <ul>
              {step.numbers.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

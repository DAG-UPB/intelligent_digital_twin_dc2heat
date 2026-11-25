/** A card that links to the technical documentation (/docs/, a separate site served once it has been built). */
export function DocsCard() {
  return (
    <section className="card card--lg help-docs" aria-labelledby="docs-title">
      <div>
        <h2 id="docs-title" className="help__h2">
          Technical documentation
        </h2>
        <p>How the causal models, the physics equations and the heat balance work, with the code behind them. It opens in a new tab and is available once the documentation has been built.</p>
      </div>
      <a className="btn btn--pill btn--primary" href="/docs/" target="_blank" rel="noreferrer">
        Open the documentation <span aria-hidden>↗</span>
      </a>
    </section>
  );
}

/** A PNG from public/ drawn as a CSS mask, so it takes the text colour (size it with a class, default 24 px). */
export function MaskIcon({ src, className }: { src: string; className?: string }) {
  return <span aria-hidden className={className ? `mask-icon ${className}` : "mask-icon"} style={{ WebkitMaskImage: `url(${src})`, maskImage: `url(${src})` }} />;
}

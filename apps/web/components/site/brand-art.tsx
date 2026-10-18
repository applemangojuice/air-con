/**
 * The brand illustration (public/brand/dang-its-hot.webp). It's artwork, not
 * a photo of our team, and the alt text says so. The bottom strip of the
 * artwork lists services we don't offer (misting systems, ventilation), so
 * it's cropped off: the page never shows a service we can't sell you.
 */
export const BRAND_ART_ALT =
  "Illustration: three cartoon friends in sunglasses and a black poodle sitting on a London street by a Clapham Common sign, next to a small white car with the Dang, It's Hot logo, with the London skyline behind them.";

export function BrandArt({ priority = false, className = "" }: { priority?: boolean; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-3xl border border-line bg-white shadow-lg ${className}`.trim()}>
      {/* Crop to the top 84% of the 1400×933 artwork: the logo and tagline stay, the services row goes. */}
      <div className="relative aspect-[1400/790] w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/dang-its-hot.webp"
          alt={BRAND_ART_ALT}
          width={1400}
          height={933}
          fetchPriority={priority ? "high" : "auto"}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          className="absolute inset-x-0 top-0 h-auto w-full"
        />
      </div>
    </div>
  );
}

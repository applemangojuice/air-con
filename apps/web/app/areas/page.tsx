import Link from "next/link";
import type { Metadata } from "next";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { PostcodeForm } from "@/components/site/postcode-form";
import { textLink } from "@/components/site/styles";
import { getPublicSettings } from "@/lib/public-settings";
import { AREA_PAGES } from "./area-data";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Where we install",
  description: "The London postcodes where we survey and install heat pumps for heating and cooling today.",
};

/** The service area, straight from settings: the only list of where we install. */
export default async function AreasPage() {
  const settings = await getPublicSettings();
  const outcodes = settings.serviceArea.slice().sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
        <h1 className="text-4xl font-display sm:text-5xl">Where we install</h1>
        <p className="mt-4 text-lg text-ink-700">
          We&apos;re starting small, so every home gets our full attention. These are the postcode areas we survey
          and install in today.
        </p>

        {outcodes.length > 0 ? (
          <ul className="mt-8 grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="Postcode areas we cover">
            {outcodes.map((o) => {
              const page = AREA_PAGES[o.toLowerCase()];
              return (
                <li key={o} className="rounded-sm border border-line bg-white px-3 py-3 text-center">
                  <span className="block text-lg font-bold">{o}</span>
                  {page ? (
                    <Link href={`/areas/${o.toLowerCase()}`} className={`text-xs ${textLink}`}>
                      {page.name}
                    </Link>
                  ) : (
                    <span className="text-xs text-ink-500">London</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-8 rounded-sm border border-line bg-white px-4 py-3 text-ink-700">
            We&apos;re finalising our first areas. Check back soon.
          </p>
        )}

        <section className="mt-12 rounded-sm border border-accent-100 bg-accent-50 p-6">
          <h2 className="text-xl font-display">Check your postcode</h2>
          <p className="mt-1 text-sm text-ink-700">
            We&apos;ll tell you straight away. If we&apos;re not there yet, you can ask us to email you once when we
            are.
          </p>
          <PostcodeForm />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

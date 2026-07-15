import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { generateQuote } from "@aircon/domain";
import { requestBooking, submitSurvey, type SubmissionResult } from "@/lib/api";
import { useDraft } from "@/lib/store";
import { theme } from "@/lib/theme";

const { colors, radius, space } = theme;

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  }).format(n);

const BAND_LABEL = { high: "Price locked", medium: "Nearly locked", low: "Provisional" } as const;

export default function ResultScreen() {
  const insets = useSafeAreaInsets();
  const { draft, reset } = useDraft();
  const quote = useMemo(() => generateQuote(draft.survey), [draft.survey]);
  const [submission, setSubmission] = useState<SubmissionResult | null>(null);
  const [booked, setBooked] = useState(false);
  const submitted = useRef(false);

  useEffect(() => {
    if (submitted.current) return;
    submitted.current = true;
    submitSurvey(draft).then(setSubmission);
    // Submit once with the survey as completed; edits mean a new run-through.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const longest = quote.finance[quote.finance.length - 1];

  async function book() {
    if (submission?.status !== "saved") return;
    const ok = await requestBooking(submission.id, "2-4-weeks", "");
    setBooked(ok);
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={{
        padding: space(5),
        paddingTop: insets.top + space(4),
        paddingBottom: space(12),
      }}
    >
      {/* Hero */}
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <Text style={styles.heroKicker}>Your fixed installation price</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {BAND_LABEL[quote.confidence.band]} · {quote.confidence.score}/100
            </Text>
          </View>
        </View>
        <Text style={styles.heroPrice}>{gbp(quote.totalGbp)}</Text>
        <Text style={styles.heroMeta}>
          {draft.survey.rooms.length} room{draft.survey.rooms.length > 1 ? "s" : ""} ·{" "}
          {quote.installDays === 1 ? "1-day install" : `${quote.installDays}-day install`} ·{" "}
          {quote.warrantyYears}-year warranty · VAT included
        </Text>
        {longest && (
          <View style={styles.financeStrip}>
            <Text style={styles.financeText}>
              Or from <Text style={styles.bold}>{gbp(longest.monthlyGbp)}/month</Text> over{" "}
              {longest.months} months with a {gbp(longest.depositGbp)} deposit.
            </Text>
          </View>
        )}
      </View>

      {/* System */}
      <Text style={styles.h2}>Your system</Text>
      {quote.systems.map((system, i) => (
        <View key={i} style={styles.card}>
          <Text style={styles.cardTitle}>{system.outdoorLabel}</Text>
          {system.rooms.map((room) => (
            <View key={room.roomId} style={styles.row}>
              <Text style={styles.rowLabel}>{room.roomName}</Text>
              <Text style={styles.rowValue}>{room.capacityKw.toFixed(1)} kW unit</Text>
            </View>
          ))}
        </View>
      ))}

      {/* Breakdown */}
      <Text style={styles.h2}>Price breakdown</Text>
      <View style={styles.card}>
        {quote.lines.map((line, i) => (
          <View key={i} style={styles.row}>
            <Text style={[styles.rowLabel, { flex: 1 }]}>{line.label}</Text>
            <Text style={styles.rowValue}>{gbp(line.amount)}</Text>
          </View>
        ))}
        <View style={[styles.row, { borderTopWidth: 1, borderTopColor: colors.line }]}>
          <Text style={[styles.rowLabel, styles.bold]}>Total (inc. VAT)</Text>
          <Text style={[styles.rowValue, styles.bold]}>{gbp(quote.totalGbp)}</Text>
        </View>
      </View>

      {/* Gaps */}
      {quote.confidence.gaps.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.amber50, borderColor: colors.line }]}>
          <Text style={[styles.cardTitle, { color: colors.amber700 }]}>To lock this price in</Text>
          {quote.confidence.gaps.map((gap) => (
            <Text key={gap} style={styles.gapText}>
              • {gap}
            </Text>
          ))}
        </View>
      )}

      {/* Status + booking */}
      {submission?.status === "saved" && (
        <Text style={styles.saved}>✓ Saved. We&apos;ve emailed your permanent quote link.</Text>
      )}
      {submission?.status === "error" && (
        <Text style={styles.error}>
          Couldn&apos;t reach the server, but your quote is still valid. Reconnect and reopen this
          screen to save it.
        </Text>
      )}

      {booked ? (
        <View style={[styles.card, { backgroundColor: colors.sage50, borderColor: colors.sage200 }]}>
          <Text style={[styles.cardTitle, { color: colors.sage700 }]}>Booking requested ✓</Text>
          <Text style={styles.gapText}>
            We&apos;ll confirm your installation date within one working day.
          </Text>
        </View>
      ) : (
        <Pressable
          style={[styles.cta, submission?.status !== "saved" && { opacity: 0.4 }]}
          disabled={submission?.status !== "saved"}
          onPress={book}
        >
          <Text style={styles.ctaText}>Book my installation</Text>
        </Pressable>
      )}

      <Pressable
        onPress={() => {
          reset();
          router.dismissAll();
        }}
      >
        <Text style={styles.startOver}>Start a new quote</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.cream },
  hero: {
    backgroundColor: colors.ink950,
    borderRadius: radius.lg,
    padding: space(6),
  },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heroKicker: { color: "rgba(255,255,255,0.7)", fontSize: 13, flex: 1 },
  badge: {
    backgroundColor: colors.sage50,
    borderRadius: radius.pill,
    paddingHorizontal: space(2.5),
    paddingVertical: 3,
  },
  badgeText: { color: colors.sage700, fontSize: 11, fontWeight: "700" },
  heroPrice: { color: colors.white, fontSize: 44, fontWeight: "800", marginTop: space(2) },
  heroMeta: { color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: space(2), lineHeight: 19 },
  financeStrip: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: radius.md,
    padding: space(3.5),
    marginTop: space(4),
  },
  financeText: { color: colors.white, fontSize: 13, lineHeight: 19 },
  bold: { fontWeight: "700" },
  h2: { fontSize: 18, fontWeight: "700", color: colors.ink900, marginTop: space(7), marginBottom: space(3) },
  card: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    padding: space(4),
    marginBottom: space(3),
  },
  cardTitle: { fontWeight: "700", color: colors.ink900, marginBottom: space(2) },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: space(3),
    paddingVertical: space(1.5),
  },
  rowLabel: { color: colors.ink500, fontSize: 14 },
  rowValue: { color: colors.ink900, fontSize: 14, fontWeight: "600" },
  gapText: { color: colors.ink700, fontSize: 13, lineHeight: 19, marginTop: 2 },
  saved: { color: colors.sage700, fontSize: 13, marginTop: space(3) },
  error: { color: colors.red600, fontSize: 13, marginTop: space(3), lineHeight: 19 },
  cta: {
    borderRadius: radius.pill,
    backgroundColor: colors.accent600,
    paddingVertical: space(4),
    alignItems: "center",
    marginTop: space(5),
  },
  ctaText: { color: colors.white, fontWeight: "700", fontSize: 16 },
  startOver: { color: colors.ink300, fontSize: 14, marginTop: space(6), fontWeight: "500" },
});

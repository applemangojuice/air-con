import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "@/lib/theme";

const { colors, radius, space } = theme;

export function Screen({
  step,
  totalSteps,
  title,
  subtitle,
  children,
  onNext,
  onBack,
  nextLabel = "Continue",
  nextDisabled = false,
  busy = false,
}: {
  step?: number;
  totalSteps?: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
  onNext?: () => void;
  onBack?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  busy?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const progress =
    step !== undefined && totalSteps ? Math.round(((step + 1) / totalSteps) * 100) : null;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={{ padding: space(5), paddingBottom: space(10) }}
        keyboardShouldPersistTaps="handled"
      >
        {progress !== null && (
          <View style={{ marginBottom: space(6) }}>
            <View style={styles.progressMeta}>
              <Text style={styles.progressText}>
                Step {step! + 1} of {totalSteps}
              </Text>
              <Text style={styles.progressText}>{progress}%</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress}%` }]} />
            </View>
          </View>
        )}
        <Text style={styles.title}>{title}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        <View style={{ marginTop: space(6), gap: space(5) }}>{children}</View>
      </ScrollView>

      {(onBack || onNext) && (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space(4)) }]}>
          {onBack && (
            <Pressable onPress={onBack} style={styles.backBtn}>
              <Text style={styles.backBtnText}>Back</Text>
            </Pressable>
          )}
          {onNext && (
            <Pressable
              onPress={onNext}
              disabled={nextDisabled || busy}
              style={[styles.nextBtn, (nextDisabled || busy) && { opacity: 0.4 }]}
            >
              <Text style={styles.nextBtnText}>{busy ? "One moment…" : nextLabel}</Text>
            </Pressable>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {hint && <Text style={styles.fieldHint}>{hint}</Text>}
    </View>
  );
}

export function Input(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.ink300}
      {...props}
      style={[styles.input, props.style]}
    />
  );
}

export interface Option<T extends string | number | boolean> {
  value: T;
  label: string;
  hint?: string;
}

export function OptionCards<T extends string | number | boolean>({
  options,
  value,
  onChange,
  columns = 2,
}: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  columns?: 2 | 3;
}) {
  return (
    <View style={styles.optionsWrap}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            style={[
              styles.option,
              { flexBasis: columns === 3 ? "30%" : "47%" },
              selected && styles.optionSelected,
            ]}
          >
            <Text style={[styles.optionLabel, selected && { color: colors.accent700 }]}>
              {o.label}
            </Text>
            {o.hint && <Text style={styles.optionHint}>{o.hint}</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.cream },
  progressMeta: { flexDirection: "row", justifyContent: "space-between", marginBottom: space(2) },
  progressText: { fontSize: 12, fontWeight: "600", color: colors.ink300 },
  progressTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: radius.pill, backgroundColor: colors.accent500 },
  title: { fontSize: 28, fontWeight: "700", color: colors.ink900, letterSpacing: -0.3 },
  subtitle: { marginTop: space(2), fontSize: 15, lineHeight: 21, color: colors.ink500 },
  footer: {
    flexDirection: "row",
    gap: space(3),
    paddingHorizontal: space(5),
    paddingTop: space(3),
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.cream,
  },
  backBtn: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space(5),
    paddingVertical: space(3.5),
  },
  backBtnText: { fontWeight: "600", color: colors.ink700 },
  nextBtn: {
    flex: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.accent600,
    paddingVertical: space(3.5),
    alignItems: "center",
  },
  nextBtnText: { fontWeight: "700", color: colors.white, fontSize: 16 },
  fieldLabel: { fontSize: 14, fontWeight: "600", color: colors.ink900, marginBottom: space(1.5) },
  fieldHint: { fontSize: 12, color: colors.ink300, marginTop: space(1.5) },
  input: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    paddingHorizontal: space(5),
    paddingVertical: space(3),
    fontSize: 16,
    color: colors.ink900,
  },
  optionsWrap: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  option: {
    flexGrow: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    paddingHorizontal: space(3),
    paddingVertical: space(3),
  },
  optionSelected: { borderColor: colors.accent600, backgroundColor: colors.accent50 },
  optionLabel: { fontSize: 14, fontWeight: "600", color: colors.ink900 },
  optionHint: { fontSize: 11, color: colors.ink300, marginTop: 2 },
});

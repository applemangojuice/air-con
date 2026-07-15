import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { Survey } from "@aircon/domain";
import {
  createVideoSurvey,
  getVideoSurvey,
  processVideoSurvey,
  uploadVideo,
} from "@/lib/api";
import { Screen } from "@/components/ui";
import { useDraft } from "@/lib/store";
import { theme } from "@/lib/theme";

const { colors, radius, space } = theme;

const PROMPTS = [
  "Walk room to room. In each one, say its name, roughly how big it is, and whether you'd like cooling in it.",
  "Point the camera at the wall you'd want the unit on, and at the windows.",
  "Step outside: show where the outdoor unit could go and the route to it.",
  "Finish at your fuse board with the door open.",
];

type Stage =
  | { name: "idle" }
  | { name: "recorded"; uri: string; fileName: string }
  | { name: "uploading" }
  | { name: "processing" }
  | { name: "done"; roomCount: number }
  | { name: "saved" } // uploaded for engineer eyes only, no AI processing
  | { name: "fallback"; reason: string };

/**
 * The video walkthrough: one narrated video builds the floor plan.
 * Transcription + extraction run server-side; the extracted rooms come back
 * into the draft for the customer to confirm on the next screen.
 */
export default function WalkthroughScreen() {
  const { draft, setSurvey } = useDraft();
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const cancelled = useRef(false);

  async function record() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Camera needed", "Allow camera access to record your walkthrough.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["videos"],
      videoMaxDuration: 180,
      quality: 0.5, // keeps files small enough to transcribe
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setStage({ name: "recorded", uri: asset.uri, fileName: asset.fileName ?? "walkthrough.mp4" });
    }
  }

  async function pickFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      videoMaxDuration: 180,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setStage({ name: "recorded", uri: asset.uri, fileName: asset.fileName ?? "walkthrough.mp4" });
    }
  }

  /** Upload the video as evidence for the engineers, no AI processing at all. */
  async function saveForReview(uri: string, fileName: string) {
    const { archetypeId, permutationId, postcode } = draft.survey;
    if (!archetypeId || !permutationId) return;
    setStage({ name: "uploading" });
    const created = await createVideoSurvey(archetypeId, permutationId, postcode, fileName);
    const uploaded = created ? await uploadVideo(created.signedUrl, uri) : false;
    if (uploaded) setStage({ name: "saved" });
    else
      setStage({
        name: "fallback",
        reason: "The video didn't upload. Carry on, your rooms are already drafted below.",
      });
  }

  async function buildPlan(uri: string, fileName: string) {
    const { archetypeId, permutationId, postcode } = draft.survey;
    if (!archetypeId || !permutationId) return;
    cancelled.current = false;

    setStage({ name: "uploading" });
    const created = await createVideoSurvey(archetypeId, permutationId, postcode, fileName);
    if (!created) {
      setStage({ name: "fallback", reason: "We couldn't reach the server, so add your rooms manually. Your answers still get you a fixed price." });
      return;
    }
    const uploaded = await uploadVideo(created.signedUrl, uri);
    if (!uploaded) {
      setStage({ name: "fallback", reason: "The video didn't upload. Add your rooms manually, and you can email us the video later." });
      return;
    }

    setStage({ name: "processing" });
    processVideoSurvey(created.id); // fire and poll, the route may run for minutes

    const deadline = Date.now() + 4 * 60 * 1000;
    while (Date.now() < deadline && !cancelled.current) {
      await new Promise((r) => setTimeout(r, 3000));
      const status = await getVideoSurvey(created.id);
      if (!status) continue;
      if (status.status === "quoted" && status.draft_survey) {
        applyExtracted(status.draft_survey as Survey);
        return;
      }
      if (status.status === "needs_review") {
        setStage({
          name: "fallback",
          reason: "Your video is saved and our team will review it. Meanwhile, add your rooms below for an instant price.",
        });
        return;
      }
    }
    if (!cancelled.current) {
      setStage({
        name: "fallback",
        reason: "This is taking longer than expected, but your video is saved. Add your rooms manually for an instant price.",
      });
    }
  }

  function applyExtracted(extracted: Survey) {
    setSurvey({
      rooms: extracted.rooms,
      electrics: { ...draft.survey.electrics, condition: extracted.electrics.condition },
      property: {
        ...draft.survey.property,
        bedrooms: Math.max(1, extracted.rooms.filter((r) => r.type === "bedroom").length),
      },
    });
    setStage({ name: "done", roomCount: extracted.rooms.length });
  }

  const busy = stage.name === "uploading" || stage.name === "processing";

  return (
    <Screen
      step={3}
      totalSteps={8}
      title="Film your walkthrough"
      subtitle="Your rooms are already drafted from your house type. A short narrated video locks in your fixed price, and it's how our engineers prepare."
      onBack={busy ? undefined : () => router.back()}
      onNext={
        stage.name === "done" || stage.name === "fallback" || stage.name === "saved"
          ? () => router.push("/survey/rooms")
          : undefined
      }
      nextLabel="Review my rooms"
    >
      <View style={styles.promptCard}>
        <Text style={styles.promptTitle}>What to film and say</Text>
        {PROMPTS.map((prompt, i) => (
          <Text key={i} style={styles.prompt}>
            {i + 1}. {prompt}
          </Text>
        ))}
      </View>

      {stage.name === "idle" && (
        <Pressable style={styles.primary} onPress={record} onLongPress={pickFromLibrary}>
          <Text style={styles.primaryText}>● Record my walkthrough</Text>
          <Text style={styles.primaryHint}>Tap to record · hold to choose an existing video</Text>
        </Pressable>
      )}

      {stage.name === "recorded" && (
        <View style={{ gap: space(3) }}>
          <View style={styles.readyCard}>
            <Text style={styles.readyText}>✓ Video ready ({stage.fileName})</Text>
          </View>
          <Pressable style={styles.primary} onPress={() => saveForReview(stage.uri, stage.fileName)}>
            <Text style={styles.primaryText}>Save for my install team</Text>
            <Text style={styles.primaryHint}>Fastest option, your rooms are already drafted</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={() => buildPlan(stage.uri, stage.fileName)}>
            <Text style={styles.secondaryText}>Or: build my plan from the video</Text>
          </Pressable>
          <Pressable onPress={record}>
            <Text style={styles.retake}>Re-record</Text>
          </Pressable>
        </View>
      )}

      {busy && (
        <View style={styles.busyCard}>
          <Text style={styles.busyTitle}>
            {stage.name === "uploading" ? "Uploading your video…" : "Building your floor plan…"}
          </Text>
          <Text style={styles.busyBody}>
            {stage.name === "uploading"
              ? "Keep the app open, this takes a moment on mobile data."
              : "We're listening to your narration and drafting your rooms. Usually under two minutes."}
          </Text>
        </View>
      )}

      {stage.name === "done" && (
        <View style={styles.doneCard}>
          <Text style={styles.doneTitle}>Floor plan drafted ✓</Text>
          <Text style={styles.doneBody}>
            We heard {stage.roomCount} room{stage.roomCount === 1 ? "" : "s"} in your walkthrough.
            Check them on the next screen. You can rename, adjust or remove anything.
          </Text>
        </View>
      )}

      {stage.name === "saved" && (
        <View style={styles.doneCard}>
          <Text style={styles.doneTitle}>Video saved ✓</Text>
          <Text style={styles.doneBody}>
            Our engineers will watch it before confirming your fixed price.
            Your rooms are already drafted. Review them next.
          </Text>
        </View>
      )}

      {stage.name === "fallback" && (
        <View style={styles.fallbackCard}>
          <Text style={styles.fallbackText}>{stage.reason}</Text>
        </View>
      )}

      {stage.name === "idle" && (
        <Pressable onPress={() => router.push("/survey/rooms")}>
          <Text style={styles.skip}>Skip the video and review my drafted rooms</Text>
        </Pressable>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  promptCard: {
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: space(4),
    gap: space(1.5),
  },
  promptTitle: { fontWeight: "700", color: colors.ink900, fontSize: 14, marginBottom: 2 },
  prompt: { fontSize: 13, lineHeight: 19, color: colors.ink700 },
  primary: {
    borderRadius: radius.pill,
    backgroundColor: colors.accent600,
    paddingVertical: space(4),
    alignItems: "center",
    gap: 2,
  },
  primaryText: { color: colors.white, fontWeight: "700", fontSize: 16 },
  primaryHint: { color: "rgba(255,255,255,0.75)", fontSize: 11 },
  secondary: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: space(3),
    alignItems: "center",
  },
  secondaryText: { color: colors.ink700, fontWeight: "600", fontSize: 14 },
  readyCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.sage200,
    backgroundColor: colors.sage50,
    padding: space(3.5),
  },
  readyText: { color: colors.sage700, fontWeight: "600", fontSize: 13 },
  retake: { color: colors.ink500, fontSize: 14, fontWeight: "500", textAlign: "center" },
  busyCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    padding: space(4),
  },
  busyTitle: { fontWeight: "700", color: colors.ink900, fontSize: 15 },
  busyBody: { fontSize: 13, lineHeight: 19, color: colors.ink500, marginTop: 4 },
  doneCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.sage200,
    backgroundColor: colors.sage50,
    padding: space(4),
  },
  doneTitle: { fontWeight: "700", color: colors.sage700, fontSize: 15 },
  doneBody: { fontSize: 13, lineHeight: 19, color: colors.ink700, marginTop: 4 },
  fallbackCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.amber50,
    padding: space(4),
  },
  fallbackText: { fontSize: 13, lineHeight: 19, color: colors.amber700 },
  skip: { color: colors.ink300, fontSize: 13, textAlign: "center", textDecorationLine: "underline" },
});

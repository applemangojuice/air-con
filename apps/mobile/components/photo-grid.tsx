import * as ImagePicker from "expo-image-picker";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { PhotoKind, SurveyPhoto } from "@aircon/domain";
import { theme } from "@/lib/theme";

const { colors, radius, space } = theme;

type LocalPhoto = SurveyPhoto & { uri?: string };

/**
 * Native photo capture: camera-first (this is the capture instrument),
 * with a long-press to pick from the library instead.
 */
export function PhotoGrid({
  kind,
  label,
  guidance,
  photos,
  onChange,
}: {
  kind: PhotoKind;
  label: string;
  /** Short capture prompt shown under the label (from docs/capture-process.md). */
  guidance?: string;
  photos: LocalPhoto[];
  onChange: (photos: LocalPhoto[]) => void;
}) {
  const mine = photos.filter((p) => p.kind === kind);

  function append(assets: ImagePicker.ImagePickerAsset[]) {
    const added: LocalPhoto[] = assets.map((a) => ({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      uri: a.uri,
      fileName: a.fileName ?? "photo.jpg",
    }));
    onChange([...photos, ...added]);
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Camera needed", "Allow camera access to photograph your home.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled) append(result.assets);
  }

  async function pickFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.7,
      allowsMultipleSelection: true,
      selectionLimit: 4,
    });
    if (!result.canceled) append(result.assets);
  }

  function remove(id: string) {
    onChange(photos.filter((p) => p.id !== id));
  }

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      {guidance && <Text style={styles.guidance}>{guidance}</Text>}
      <View style={styles.grid}>
        {mine.map((p) => (
          <View key={p.id} style={styles.thumbWrap}>
            {p.uri ? (
              <Image source={{ uri: p.uri }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.thumbSaved]}>
                <Text style={styles.thumbSavedText}>saved</Text>
              </View>
            )}
            <Pressable style={styles.remove} onPress={() => remove(p.id)}>
              <Text style={styles.removeText}>×</Text>
            </Pressable>
          </View>
        ))}
        <Pressable style={styles.add} onPress={takePhoto} onLongPress={pickFromLibrary}>
          <Text style={styles.addIcon}>📷</Text>
          <Text style={styles.addText}>Add photo</Text>
        </Pressable>
      </View>
      <Text style={styles.tip}>Tap for camera · hold to choose from library</Text>
    </View>
  );
}

const SIZE = 84;

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: "600", color: colors.ink900 },
  guidance: { fontSize: 12, color: colors.ink500, marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) },
  thumbWrap: { position: "relative" },
  thumb: { width: SIZE, height: SIZE, borderRadius: radius.md, backgroundColor: colors.surface },
  thumbSaved: { alignItems: "center", justifyContent: "center" },
  thumbSavedText: { fontSize: 11, color: colors.ink300 },
  remove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(22,20,18,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  removeText: { color: colors.white, fontSize: 12, lineHeight: 14 },
  add: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.md,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  addIcon: { fontSize: 18 },
  addText: { fontSize: 10, fontWeight: "600", color: colors.ink300 },
  tip: { fontSize: 11, color: colors.ink300, marginTop: space(1.5) },
});

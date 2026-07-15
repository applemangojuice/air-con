import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { buildPresetRoom, getArchetype, type RoomType } from "@aircon/domain";
import { Screen } from "@/components/ui";
import { ROOM_TYPE_LABEL, newRoom, useDraft } from "@/lib/store";
import { theme } from "@/lib/theme";

const { colors, radius, space } = theme;

const ADDABLE: RoomType[] = [
  "bedroom",
  "living-room",
  "kitchen-diner",
  "home-office",
  "loft-room",
  "conservatory",
  "other",
];

export default function RoomsScreen() {
  const { draft, setSurvey } = useDraft();
  const rooms = draft.survey.rooms;
  const archetype = draft.survey.archetypeId
    ? getArchetype(draft.survey.archetypeId)
    : undefined;

  // Stock-floor-plan rooms not yet added — one tap adds them fully configured.
  const remainingPresets = archetype
    ? archetype.typicalRooms
        .map((preset, i) => ({ preset, room: buildPresetRoom(archetype.id, preset, i) }))
        .filter(({ room }) => !rooms.some((r) => r.id === room.id))
    : [];

  function addRoom(type: RoomType) {
    const room = newRoom(type, rooms);
    setSurvey({ rooms: [...rooms, room] });
    router.push({ pathname: "/survey/room/[id]", params: { id: room.id } });
  }

  return (
    <Screen
      step={4}
      totalSteps={8}
      title="Which rooms should we cool?"
      subtitle={
        archetype
          ? `We've drafted the usual rooms for a ${archetype.name.toLowerCase()}. Remove any you don't need, tap one to adjust it, or add more.`
          : "Add every room you'd like a unit in. You can drop rooms later — the price updates instantly."
      }
      onBack={() => router.back()}
      onNext={() => router.push("/survey/outdoor")}
      nextDisabled={rooms.length === 0}
      nextLabel={
        rooms.length > 0
          ? `Continue with ${rooms.length} room${rooms.length > 1 ? "s" : ""}`
          : "Add a room first"
      }
    >
      {rooms.length > 0 && (
        <View style={{ gap: space(2.5) }}>
          {rooms.map((room) => (
            <Pressable
              key={room.id}
              style={styles.roomCard}
              onPress={() =>
                router.push({ pathname: "/survey/room/[id]", params: { id: room.id } })
              }
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.roomName}>{room.name}</Text>
                <Text style={styles.roomMeta}>
                  {ROOM_TYPE_LABEL[room.type]} · {room.size} ·{" "}
                  {room.photos.length > 0
                    ? `${room.photos.length} photo${room.photos.length > 1 ? "s" : ""}`
                    : "no photos yet"}
                </Text>
              </View>
              <Text style={styles.roomEdit}>Edit</Text>
            </Pressable>
          ))}
        </View>
      )}

      {remainingPresets.length > 0 && (
        <View>
          <Text style={styles.addLabel}>
            More rooms in a typical {archetype!.name.toLowerCase()}
          </Text>
          <View style={styles.chips}>
            {remainingPresets.map(({ room }) => (
              <Pressable
                key={room.id}
                style={[styles.chip, styles.presetChip]}
                onPress={() => setSurvey({ rooms: [...rooms, room] })}
              >
                <Text style={styles.presetChipText}>+ {room.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <View>
        <Text style={styles.addLabel}>
          {rooms.length === 0 ? "Add your first room" : "Add a different room"}
        </Text>
        <View style={styles.chips}>
          {ADDABLE.map((type) => (
            <Pressable key={type} style={styles.chip} onPress={() => addRoom(type)}>
              <Text style={styles.chipText}>+ {ROOM_TYPE_LABEL[type]}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  roomCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    paddingHorizontal: space(4),
    paddingVertical: space(3.5),
  },
  roomName: { fontWeight: "600", color: colors.ink900, fontSize: 15 },
  roomMeta: { fontSize: 12, color: colors.ink300, marginTop: 2 },
  roomEdit: { color: colors.accent600, fontWeight: "600", fontSize: 14 },
  addLabel: { fontSize: 14, fontWeight: "600", color: colors.ink900, marginBottom: space(2) },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    paddingHorizontal: space(4),
    paddingVertical: space(2),
  },
  chipText: { fontSize: 14, fontWeight: "500", color: colors.ink700 },
  presetChip: { borderColor: colors.sage200, backgroundColor: colors.sage50 },
  presetChipText: { fontSize: 14, fontWeight: "600", color: colors.sage700 },
});

import { router, useLocalSearchParams } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";
import { PhotoGrid } from "@/components/photo-grid";
import { Field, Input, OptionCards, Screen } from "@/components/ui";
import { useDraft } from "@/lib/store";
import { theme } from "@/lib/theme";

export default function RoomEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { draft, setSurvey, updateRoom } = useDraft();
  const room = draft.survey.rooms.find((r) => r.id === id);

  if (!room) {
    // Deleted or bad deep link, go back to the list.
    router.replace("/survey/rooms");
    return null;
  }

  function removeRoom() {
    setSurvey({ rooms: draft.survey.rooms.filter((r) => r.id !== id) });
    router.back();
  }

  return (
    <Screen
      title={room.name}
      subtitle="A few details and one photo. Get the wall you'd want the unit on in shot."
      onBack={() => router.back()}
      onNext={() => router.back()}
      nextLabel="Done"
    >
      <Field label="Room name">
        <Input value={room.name} onChangeText={(name) => updateRoom(room.id, { name })} />
      </Field>
      <Field label="How big is it?">
        <OptionCards
          value={room.size}
          onChange={(size) => updateRoom(room.id, { size })}
          options={[
            { value: "small", label: "Small", hint: "Box room, up to ~10 m²" },
            { value: "medium", label: "Medium", hint: "Double bedroom, ~10–16 m²" },
            { value: "large", label: "Large", hint: "Main living room, ~16–24 m²" },
            { value: "xl", label: "Very large", hint: "Open plan, 24 m²+" },
          ]}
        />
      </Field>
      <Field label="Which floor?">
        <OptionCards
          value={room.floor}
          onChange={(floor) => updateRoom(room.id, { floor })}
          options={[
            { value: "ground", label: "Ground floor" },
            { value: "first", label: "First floor" },
            { value: "second-plus", label: "Second or higher" },
            { value: "loft", label: "Loft" },
          ]}
        />
      </Field>
      <Field label="How much window glass?">
        <OptionCards
          columns={3}
          value={room.glazing}
          onChange={(glazing) => updateRoom(room.id, { glazing })}
          options={[
            { value: "low", label: "A little" },
            { value: "medium", label: "Average" },
            { value: "high", label: "Lots" },
          ]}
        />
      </Field>
      <Field
        label="Which way do the windows face?"
        hint="South- and west-facing rooms get more sun, so they need a touch more cooling."
      >
        <OptionCards
          columns={3}
          value={room.orientation}
          onChange={(orientation) => updateRoom(room.id, { orientation })}
          options={[
            { value: "north", label: "North" },
            { value: "east", label: "East" },
            { value: "south", label: "South" },
            { value: "west", label: "West" },
            { value: "unsure", label: "Not sure" },
          ]}
        />
      </Field>
      <Field label="Does the room have an outside wall?">
        <OptionCards
          value={room.hasExternalWall}
          onChange={(hasExternalWall) => updateRoom(room.id, { hasExternalWall })}
          options={[
            { value: true, label: "Yes", hint: "Easiest pipe route" },
            { value: false, label: "No", hint: "We'll route internally" },
          ]}
        />
      </Field>
      <PhotoGrid
        kind="room"
        label="Photo of the room"
        guidance="Stand in the doorway. Whole target wall in frame, ceiling line visible."
        photos={room.photos}
        onChange={(photos) => updateRoom(room.id, { photos })}
      />
      <Pressable onPress={removeRoom}>
        <Text style={styles.remove}>Remove this room</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  remove: { color: theme.colors.red600, fontWeight: "600", fontSize: 14 },
});

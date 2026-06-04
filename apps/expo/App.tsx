import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { EditorScreen } from "./src/components/EditorScreen";

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#f4efe6" }}>
        <StatusBar style="dark" />
        <EditorScreen />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

import React from "react";
import { Box, Text } from "ink";

const ROLE_INFO = {
  user: {
    label: "User",
    color: "green",
    emoji: "(・∀・)/"
  },
  system: {
    label: "System",
    color: "yellow",
    emoji: "[・_・?]"
  },
  assistant: {
    label: "Sapni",
    color: "cyan",
    emoji: "( ´ ▽ ` )ﾉ"
  },
  default: {
    label: "Unknown",
    color: "gray",
    emoji: "(???)"
  }
};

const Msg = React.memo(function Msg({ role, content }) {
  const info = ROLE_INFO[role] || ROLE_INFO.default;
  const lines = content.split("\n").filter(l => l.trim());

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={2}>
        <Text color={info.color}>{info.emoji}</Text>
        <Text color={info.color} bold>{info.label}</Text>
        <Text color="gray" dimColor>- {lines.length} lines</Text>
      </Box>
      
      <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={2} paddingY={1}>
        <Box flexDirection="column">
          {lines.map((line, i) => (
            <Text key={i} color="white">
              {line || " "}
            </Text>
          ))}
        </Box>
      </Box>
    </Box>
  );
});

export default Msg;

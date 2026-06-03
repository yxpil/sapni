import React from "react";
import { Box, Text } from "ink";

const StatusBar = React.memo(function StatusBar({ model, messageCount, contextPct, cols }) {
  const ctxColor = contextPct > 90 ? "red" : contextPct > 80 ? "yellow" : "green";
  
  // Dynamic width based on terminal columns
  const width = cols || 80;
  
  return (
    <Box paddingX={1} flexWrap="wrap">
      <Text dimColor>
        <Text color="magenta">{model}</Text>
        {" | "}
        <Text color="cyan">msg {messageCount}</Text>
        {" | "}
        <Text color={ctxColor}>ctx {contextPct.toFixed(3)}%</Text>
      </Text>
      <Text dimColor> · F1 Help · Esc Clear · Double-click Exit</Text>
    </Box>
  );
});

export default StatusBar;

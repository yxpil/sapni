import React from "react";
import { Box, Text } from "ink";

const Streaming = React.memo(function Streaming({ content }) {
  const lines = content.split("\n");
  const lastLine = lines[lines.length - 1] || "";
  
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={2}>
        <Text color="cyan">( ´ ▽ ` )ﾉ</Text>
        <Text color="cyan" bold>Sapni</Text>
        <Text color="gray" dimColor>(streaming...)</Text>
      </Box>
      
      <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={2} paddingY={1}>
        <Box flexDirection="column">
          {lines.slice(0, -1).map((line, i) => (
            <Text key={i} color="white">{line}</Text>
          ))}
          <Text color="white">{lastLine}</Text>
          <Text color="gray">▌</Text>
        </Box>
      </Box>
    </Box>
  );
});

export default Streaming;

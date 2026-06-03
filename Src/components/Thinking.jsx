import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";

const Thinking = React.memo(function Thinking({ text, iteration, content }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={2} paddingY={1}>
      <Box flexDirection="row" gap={2}>
        <Text color="magenta"><Spinner type="dots" /></Text>
        <Text color="magenta" bold>思考中 / Thinking</Text>
        {iteration > 1 && (
          <Text color="gray" dimColor>Iteration {iteration}</Text>
        )}
      </Box>
      
      {(content || text) && (
        <Box marginTop={1} flexDirection="column">
          <Text color="cyan" dimColor>[Process]</Text>
          <Text color="white" marginTop={0.5}>
            {content || text}
          </Text>
        </Box>
      )}
    </Box>
  );
});

export default Thinking;

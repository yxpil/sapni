import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";

function colorResult(result) {
  if (!result) return null;
  const r = result.toLowerCase();
  if (r.includes("error") || r.includes("fail") || r.includes("exception")) {
    return { color: "red", text: result };
  }
  if (r.includes("success") || r.includes("ok") || r.includes("done")) {
    return { color: "green", text: result };
  }
  return null;
}

const ToolLogItem = React.memo(function ToolLogItem({ tool }) {
  const cr = colorResult(tool.result);
  
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row" gap={1}>
        {tool.status === "done"
          ? <Text color="green">✓</Text>
          : <Text color="yellow"><Spinner type="dots" /></Text>}
        <Text color="magenta" bold>{tool.name}</Text>
        {tool.status !== "done" && <Text color="yellow">(工作中…)</Text>}
      </Box>
      
      {tool.args && (
        <Box paddingLeft={2} marginTop={0.5}>
          <Text color="cyan" dimColor>[参数]</Text>
          <Text color="#8b949e"> {tool.args}</Text>
        </Box>
      )}
      
      {tool.result && (
        <Box paddingLeft={2} marginTop={0.5} borderStyle="round" borderColor="gray" paddingX={2} paddingY={1}>
          <Text color="cyan" dimColor>[结果]</Text>
          <Box marginTop={0.5}>
            {(() => {
              const lines = tool.result.split("\n").filter(l => l.trim());
              if (lines.length <= 1) {
                return (
                  <Text color={cr?.color || "white"}>{tool.result.slice(0, 200)}</Text>
                );
              }
              return (
                <Box flexDirection="column">
                  {lines.map((l, j) => {
                    const lineCr = colorResult(l);
                    return (
                      <Text key={j} color={lineCr?.color || "white"}>
                        {lineCr?.text || l.slice(0, 200)}
                      </Text>
                    );
                  }).slice(0, 8)}
                  {lines.length > 8 && <Text color="#8b949e" dimColor>... (+{lines.length - 8} lines)</Text>}
                </Box>
              );
            })()}
          </Box>
        </Box>
      )}
    </Box>
  );
});

const ToolLog = React.memo(function ToolLog({ tools, collapsed }) {
  if (!tools || tools.length === 0) return null;

  const completedCount = tools.filter(t => t.status === "done").length;
  const runningCount = tools.length - completedCount;

  if (collapsed) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={2} paddingY={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text color="#8b949e" dimColor>Tool Calls</Text>
          <Text color="#8b949e" dimColor>{completedCount}/{tools.length}</Text>
        </Box>
        <Box flexDirection="column" marginTop={1} gap={0.5}>
          {tools.map((t, i) => (
            <Box key={i} flexDirection="row" gap={1}>
              {t.status === "done"
                ? <Text color="green">✓</Text>
                : <Text color="yellow"><Spinner type="dots" /></Text>}
              <Text color="magenta">{t.name}</Text>
              {runningCount === 0 && (
                <Text color="#8b949e" dimColor>- {t.result?.length > 50 ? t.result.slice(0, 50) + "..." : t.result}</Text>
              )}
            </Box>
          ))}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={2} paddingY={1}>
      <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <Text color="#8b949e" dimColor>{"─".repeat(10)} 工具调用 ({tools.length})</Text>
                <Text color="#8b949e" dimColor>{completedCount} 完成{runningCount > 0 ? `, {runningCount} 执行中` : ""}</Text>
      </Box>
      <Box flexDirection="column" gap={1}>
        {tools.map((t, i) => (
          <ToolLogItem key={i} tool={t} />
        ))}
      </Box>
    </Box>
  );
}, (prevProps, nextProps) => {
  if (prevProps.collapsed !== nextProps.collapsed) return false;
  if (prevProps.tools?.length !== nextProps.tools?.length) return false;
  for (let i = 0; i < (prevProps.tools?.length || 0); i++) {
    const prev = prevProps.tools[i];
    const next = nextProps.tools[i];
    if (prev?.name !== next?.name || prev?.status !== next?.status || prev?.result !== next?.result) {
      return false;
    }
  }
  return true;
});

export default ToolLog;

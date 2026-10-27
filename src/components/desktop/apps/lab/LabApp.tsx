import { useState } from "react";
import { LESSONS } from "../../../../lib/lab/lessons";
import { DEFAULT_LAB, parseLab } from "../../../../lib/lab/progress";
import { useStoredState } from "../../../../lib/storage";
import { LessonCatalog } from "./LessonCatalog";
import { LessonLab } from "./LessonLab";

/**
 * jv_lab: pick a lesson, then read it beside a simulated terminal that waits for its challenges.
 * The challenges done and the column split are kept in `jarvis.lab`.
 */
export function LabApp() {
  const [progress, setProgress] = useStoredState("jarvis.lab", DEFAULT_LAB, parseLab);
  const [openId, setOpenId] = useState<string | null>(null);
  // Back in the catalog, the keyboard returns to the lesson just left.
  const [leftId, setLeftId] = useState<string | null>(null);
  const lesson = LESSONS.find((item) => item.id === openId);

  return (
    <div data-testid="lab-app" className="flex h-full flex-col font-mono text-[12.5px] text-hud-text">
      {lesson ? (
        <LessonLab
          key={lesson.id}
          lesson={lesson}
          progress={progress}
          setProgress={setProgress}
          onBack={() => {
            setLeftId(lesson.id);
            setOpenId(null);
          }}
        />
      ) : (
        <LessonCatalog progress={progress} focusId={leftId} onOpen={setOpenId} />
      )}
    </div>
  );
}

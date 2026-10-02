import type { Metadata } from "next";
import { SignalStage } from "@/components/concepts/signal/signal-stage";
import styles from "@/components/concepts/signal/signal.module.css";

export const metadata: Metadata = {
  title: "Konstantin Stanmeyer",
};

export default function SignalPage() {
  return (
    <SignalStage>
      <h1 className={styles.name}>
        <span data-line>Konstantin</span> <span data-line>Stanmeyer</span>
      </h1>
    </SignalStage>
  );
}

import React from "react";
import { downloadResultsJson } from "../utils/exportResultsJson";

type Props = {
  className?: string;
  label?: string;
};

export default function ExportResultsButton(props: Props) {
  const { className, label = "集計JSONを生成してダウンロード" } = props;

  const onClick = async () => {
    try {
      await downloadResultsJson("results.json");
    } catch (e) {
      alert("JSON生成に失敗しました（ブラウザ互換やIndexedDB権限の可能性）");
      // eslint-disable-next-line no-console
      console.error(e);
    }
  };

  return (
    <button type="button" className={className} onClick={onClick}>
      {label}
    </button>
  );
}

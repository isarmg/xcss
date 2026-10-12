import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, Dialog, FormField, Select, TextField } from "../../../dist/admin-ui/index.js";
import { startServerCorners } from "../../../dist/admin-ui/server-corners.js";
import "../../../web/design-tokens/tokens.css";
import "../../../web/design-tokens/tokens.dark.css";
import "../../../web/design-tokens/reset.css";
import "../../../web/design-tokens/accessibility.css";
import "../../../web/admin-ui/styles.css";
function Fixture() {
  const [value, setValue] = useState("a"), [disabled, setDisabled] = useState(false);
  const [dialog, setDialog] = useState(false), [dynamic, setDynamic] = useState(false);
  const [label, setLabel] = useState("Controlled"), [submitted, setSubmitted] = useState("");
  const change = event => {
    window.selectEvents.push({ value: event.target.value, tag: event.target.tagName, currentTag: event.currentTarget.tagName,
      nativeType: event.nativeEvent.type, targetMatchesCurrent: event.target === event.currentTarget,
      selected: Array.from(event.currentTarget.selectedOptions, option => option.value) });
    setValue(event.target.value);
  };
  const options = <><option value="a">Alpha</option><option value="b" disabled>Beta disabled</option><optgroup label="Unavailable" disabled><option value="d">Dead group</option></optgroup><option value="g">Gamma</option><option value="z">Zulu</option></>;
  return <main style={{ padding: 24, maxWidth: 400 }}>
    <div id="clipped-parent" style={{ height: 66, overflow: "hidden", background: "white" }}><FormField label="Painted"><Select id="painted" defaultValue="a"><option value="a">Alpha</option><option value="b">Beta</option><option value="c">Gamma</option></Select></FormField></div>
    <form id="controls" onSubmit={event => { event.preventDefault(); setSubmitted(JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))); }}>
      <fieldset disabled={disabled}><FormField label={label}><Select id="controlled" name="controlled" value={value} onChange={change}>{options}</Select></FormField></fieldset>
      <FormField label="Uncontrolled"><Select name="uncontrolled" defaultValue="g" onChange={event => window.uncontrolledChanges.push(event.target.value)}>{options}</Select></FormField>
      <FormField label="Required"><Select name="required" required defaultValue=""><option value="">Choose</option><option value="ok">Ready</option></Select></FormField>
      <Button type="reset">Reset fields</Button><Button type="submit">Submit fields</Button>
      <output data-testid="submitted">{submitted}</output>
    </form>
    <Button onClick={() => setDisabled(value => !value)}>Toggle fieldset</Button>
    <Button onClick={() => setLabel("Renamed controlled")}>Rename label</Button>
    <FormField label="Dynamic"><Select defaultValue="g" name="dynamic"><option value="a">Alpha</option>{!dynamic && <option value="g">Gamma</option>}</Select></FormField>
    <Button onClick={() => setDynamic(value => !value)}>Remove option</Button>
    <FormField label="Text input"><TextField defaultValue="Value" /></FormField>
    <FormField label="Multiple"><Select name="many" aria-label="Multiple" multiple size={3} defaultValue={["a"]} onChange={event => { window.multipleValues = Array.from(event.target.selectedOptions, option => option.value); }}>{options}</Select></FormField>
    <Button onClick={() => setDialog(true)}>Open select dialog</Button>
    {dialog && <Dialog title="Select dialog" onClose={() => setDialog(false)}><div style={{ height: 90, overflow: "hidden" }}><FormField label="Dialog choice"><Select defaultValue="a">{options}</Select></FormField></div><Button>Dialog next</Button></Dialog>}
    <style>{`html,body{background:white}.xcss-select-panel{background:rgb(0,0,255);border:0}.xcss-select-option[data-active=true]{background:rgb(255,0,0);color:white}`}</style>
  </main>;
}
window.selectEvents = []; window.uncontrolledChanges = []; window.multipleValues = [];
startServerCorners(document);
createRoot(document.getElementById("root")).render(<StrictMode><Fixture /></StrictMode>);

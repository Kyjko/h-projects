function create(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function isReadOnly(field) {
  const validation = field.validation || {};
  const modifiers = Array.isArray(validation.modifiers) ? validation.modifiers : [];
  const fieldNumber = String(field.fieldNo ?? "");
  return field.name === "@ID"
    || fieldNumber === "0"
    || fieldNumber === "@ID"
    || field.readOnly === true
    || modifiers.some((modifier) => /NOINPUT/i.test(modifier))
    || /NOINPUT/i.test(validation.raw || "");
}

function sourceValues(fields) {
  const values = new Map();
  for (const field of fields || []) {
    if (!field || typeof field.name !== "string") continue;
    const list = values.get(field.name) || [];
    list.push({ mv: Number(field.mv) || list.length + 1, value: field.value ?? "" });
    values.set(field.name, list);
  }
  return values;
}

function makeValueInput(field, value, readOnly, mv) {
  const input = create("input", readOnly ? "designer-value designer-value-readonly" : "designer-value");
  input.type = "text";
  input.value = value;
  input.dataset.fieldName = field.name;
  if (mv !== undefined) input.dataset.mv = String(mv);
  input.autocomplete = "off";
  input.spellcheck = false;
  if (readOnly) {
    input.disabled = true;
    input.placeholder = "Maintained by Transact";
  }
  return input;
}

function makeField(field, initialValues) {
  const readOnly = isReadOnly(field);
  const group = create("div", `designer-field${readOnly ? " is-readonly" : ""}`);
  group.dataset.fieldName = field.name;

  const heading = create("div", "designer-field-heading");
  const label = create("label", "designer-field-label", field.name);
  const hint = [field.typeLabel, field.multi ? "Repeating" : ""].filter(Boolean).join(" · ");
  label.title = hint;
  heading.append(label);
  if (readOnly) heading.append(create("span", "designer-field-badge", "Transact managed"));
  else if (field.required === true || field.mandatory === true) {
    heading.append(create("span", "designer-field-badge required", "Required"));
  }
  if (hint) heading.append(create("span", "designer-field-hint", hint));
  group.append(heading);

  if (field.multi) {
    const rows = create("div", "designer-repeating");
    const values = initialValues.length ? initialValues : [{ value: "" }];
    values.forEach((entry, index) => {
      const row = create("div", "designer-repeat-row");
      row.append(makeValueInput(field, String(entry.value ?? ""), readOnly, index + 1));
      if (!readOnly) {
        const remove = create("button", "designer-remove-row", "Remove");
        remove.type = "button";
        remove.setAttribute("aria-label", `Remove ${field.name} row ${index + 1}`);
        remove.addEventListener("click", () => {
          if (rows.childElementCount > 1) row.remove();
          else row.querySelector("input").value = "";
        });
        row.append(remove);
      }
      rows.append(row);
    });
    group.append(rows);
    if (!readOnly) {
      const add = create("button", "designer-add-row", `+ Add ${field.name} value`);
      add.type = "button";
      add.addEventListener("click", () => {
        const row = create("div", "designer-repeat-row");
        const nextPosition = rows.childElementCount + 1;
        row.append(makeValueInput(field, "", false, nextPosition));
        const remove = create("button", "designer-remove-row", "Remove");
        remove.type = "button";
        remove.setAttribute("aria-label", `Remove ${field.name} row ${nextPosition}`);
        remove.addEventListener("click", () => {
          if (rows.childElementCount > 1) row.remove();
          else row.querySelector("input").value = "";
        });
        row.append(remove);
        rows.append(row);
        row.querySelector("input").focus();
      });
      group.append(add);
    }
  } else {
    group.append(makeValueInput(field, initialValues[0] ? String(initialValues[0].value ?? "") : "", readOnly));
  }
  return group;
}

export function renderDesignerFields(schema, container, copiedFields = []) {
  const fields = [...(schema.coreFields || []), ...(schema.localFields || [])]
    .filter((field) => field && typeof field.name === "string" && field.name !== "@ID")
    .filter((field, index, all) => all.findIndex((entry) => entry.name === field.name) === index);
  const source = sourceValues(copiedFields);
  container.replaceChildren();
  if (!fields.length) {
    container.append(create("p", "designer-empty", "No field definitions were returned for this application."));
    return 0;
  }
  for (const field of fields) {
    container.append(makeField(field, source.get(field.name) || []));
  }
  return fields.length;
}

export function collectDesignerFields(container) {
  const result = [];
  for (const group of container.querySelectorAll(".designer-field:not(.is-readonly)")) {
    const name = group.dataset.fieldName;
    const inputs = [...group.querySelectorAll(".designer-value:not(:disabled)")];
    if (inputs.some((input) => input.dataset.mv !== undefined)) {
      let mv = 0;
      for (const input of inputs) {
        if (!input.value.trim()) continue;
        mv += 1;
        result.push({ name, mv, value: input.value });
      }
    } else {
      const input = inputs[0];
      if (input?.value.trim()) result.push({ name, value: input.value });
    }
  }
  return result;
}

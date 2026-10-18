/**
 * The UI kit (contract §F): the house primitives for ops, field and portal
 * screens. Tailwind tokens from app/globals.css only; pill buttons,
 * rounded-2xl cards, ink-500 for secondary text.
 *
 * ModeBanner is server-only (it reads the environment through modules that
 * touch Node APIs), so it's deliberately not re-exported here: client
 * components import this index freely. Import it from
 * "@/components/kit/mode-banner".
 */
export { Badge, StatusChip, STATUS_CHIP, statusChip, type Tone } from "./badge";
export { BlockerList } from "./blocker-list";
export { Button, LinkButton, buttonClass, type ButtonProps, type ButtonSize, type ButtonVariant, type LinkButtonProps } from "./button";
export { Card } from "./card";
export {
  Checkbox,
  Field,
  Fieldset,
  Input,
  Select,
  Textarea,
  inputClass,
  selectClass,
  textareaClass,
  type ControlProps,
  type SelectOption,
} from "./form";
export { EmptyState, PageHeader, Section, Stat } from "./layout";
export { Money } from "./money";
export { NavLink } from "./nav-link";
export { Tabs, type TabItem } from "./tabs";

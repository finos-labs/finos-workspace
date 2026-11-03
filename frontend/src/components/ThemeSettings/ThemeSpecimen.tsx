import type { ReactNode } from "react";
import { Button } from "~/components/ds/atoms/Button";
import { Checkbox } from "~/components/ds/atoms/Checkbox";
import { Input } from "~/components/ds/atoms/Input";
import { Select } from "~/components/ds/atoms/Select";
import { Switch } from "~/components/ds/atoms/Switch";
import { Tag } from "~/components/ds/atoms/Tag";
import { Notice } from "~/components/ds/molecules/Notice";
import { Tabs, TabsList, TabsTrigger } from "~/components/ds/molecules/Tabs";

const TAGS = [
  "grey",
  "success",
  "warning",
  "danger",
  "brand",
  "ruby",
  "purple",
  "yellow",
  "dark-blue",
  "burgundy",
] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="body-xs-medium text-ds-text-caption">{title}</h4>
      {children}
    </section>
  );
}

export function ThemeSpecimen() {
  return (
    <div className="@container rounded border border-general-border-primary bg-surface-page p-4">
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 @lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-5">
          <Section title="Text">
            <p className="body-md-medium text-ds-text-heading">Heading text</p>
            <p className="body-sm-regular text-ds-text-subtitle">Subtitle text</p>
            <p className="body-xs-regular text-ds-text-body">
              Body text with a <span className="text-link-color underline">link</span>.
            </p>
            <p className="body-xs-regular text-ds-text-caption">Caption text</p>
          </Section>

          <Section title="Buttons">
            <div className="flex flex-wrap gap-2">
              <Button size="sm">Primary</Button>
              <Button size="sm" variant="secondary">
                Secondary
              </Button>
              <Button size="sm" variant="outlined">
                Outlined
              </Button>
              <Button size="sm" variant="warning">
                Warning
              </Button>
              <Button size="sm" variant="danger">
                Danger
              </Button>
              <Button size="sm" variant="ghost">
                Ghost
              </Button>
              <Button size="sm" disabled={true}>
                Disabled
              </Button>
            </div>
          </Section>

          <Section title="Tabs">
            <Tabs value="one" variant="filled_secondary">
              <TabsList>
                <TabsTrigger value="one">First</TabsTrigger>
                <TabsTrigger value="two">Second</TabsTrigger>
                <TabsTrigger value="three">Third</TabsTrigger>
              </TabsList>
            </Tabs>
            <Tabs value="one" variant="filled">
              <TabsList>
                <TabsTrigger value="one">First</TabsTrigger>
                <TabsTrigger value="two">Second</TabsTrigger>
              </TabsList>
            </Tabs>
          </Section>

          <Section title="Tags">
            <div className="flex flex-wrap gap-2">
              {TAGS.map((color) => (
                <Tag key={color} color={color}>
                  {color}
                </Tag>
              ))}
            </div>
          </Section>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <Section title="Controls">
            <div className="grid grid-cols-2 gap-3">
              <Input
                value="Input text"
                size="sm"
                clearable={false}
                onChange={() => {}}
              />
              <Select
                options={[
                  { label: "First option", value: "first" },
                  { label: "Second option", value: "second" },
                ]}
                value="first"
                onChange={() => {}}
                size="sm"
              />
            </div>
            <div className="flex items-center gap-4">
              <Switch checked={true} label="Switch" />
              <Switch checked={false} label="Off" />
              <Checkbox checked={true} />
            </div>
          </Section>

          <Section title="Alerts">
            <Notice variant="info" title="Information" />
            <Notice variant="success" title="Success" />
            <Notice variant="warning" title="Warning" />
            <Notice variant="error" title="Error" />
          </Section>

          <Section title="Table">
            <table className="w-full text-left body-xs-regular">
              <thead>
                <tr className="bg-table-header-bg text-ds-text-heading">
                  <th className="px-3 py-1.5">Name</th>
                  <th className="px-3 py-1.5">Value</th>
                </tr>
              </thead>
              <tbody>
                {["Alpha", "Beta"].map((name, index) => (
                  <tr
                    key={name}
                    className="bg-table-cell-bg text-ds-text-body hover:bg-table-cell-bg-hover"
                  >
                    <td className="px-3 py-1.5">{name}</td>
                    <td className="px-3 py-1.5">{index + 1}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>
      </div>
    </div>
  );
}

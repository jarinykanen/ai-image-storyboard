import { Group, SimpleGrid, Slider, Text } from '@mantine/core';

export function ShotDetailSlider({ value, disabled, onChange }: {
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return <div>
    <Group justify="space-between" gap="xs" mb={4}>
      <Text size="sm" fw={500}>Shot detail</Text>
      <Text size="sm" fw={600}>{value} / 100</Text>
    </Group>
    <Text size="xs" c="dimmed" mb="xl">Simple shots are concise. Detailed shots include richer action, composition, camera, and atmosphere.</Text>
    <Slider
      aria-label="Shot detail"
      value={value}
      min={0}
      max={100}
      step={1}
      disabled={disabled}
      label={sliderValue => `${sliderValue}%`}
      marks={[{ value: 0 }, { value: 50 }, { value: 100 }]}
      onChange={onChange}
    />
    <SimpleGrid cols={3} mt="xs" spacing="xs">
      <Text size="xs" c="dimmed">0 · Simple</Text>
      <Text size="xs" c="dimmed" ta="center">50 · Balanced</Text>
      <Text size="xs" c="dimmed" ta="right">100 · Extremely detailed</Text>
    </SimpleGrid>
  </div>;
}

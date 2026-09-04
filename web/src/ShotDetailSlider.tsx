import { Group, SimpleGrid, Slider, Text } from '@mantine/core';

export function ShotDetailSlider({ value, disabled, onChange, label = 'Shot detail', description = 'Simple shots are concise. Detailed shots include richer action, composition, camera, and atmosphere.', ariaLabel = 'Shot detail', lowLabel = 'Simple', middleLabel = 'Balanced', highLabel = 'Extremely detailed' }: {
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  label?: string;
  description?: string;
  ariaLabel?: string;
  lowLabel?: string;
  middleLabel?: string;
  highLabel?: string;
}) {
  return <div>
    <Group justify="space-between" gap="xs" mb={4}>
      <Text size="sm" fw={500}>{label}</Text>
      <Text size="sm" fw={600}>{value} / 100</Text>
    </Group>
    <Text size="xs" c="dimmed" mb="xl">{description}</Text>
    <Slider
      aria-label={ariaLabel}
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
      <Text size="xs" c="dimmed">0 · {lowLabel}</Text>
      <Text size="xs" c="dimmed" ta="center">50 · {middleLabel}</Text>
      <Text size="xs" c="dimmed" ta="right">100 · {highLabel}</Text>
    </SimpleGrid>
  </div>;
}

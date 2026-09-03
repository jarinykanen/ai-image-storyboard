import { createTheme, type MantineColorsTuple } from '@mantine/core';

const studio: MantineColorsTuple = ['#edf9f1', '#d7f0df', '#addfbe', '#80cd9a', '#5fbe7d', '#49b267', '#3ca95c', '#2c8647', '#206a37', '#14502a'];

export const studioTheme = createTheme({
  primaryColor: 'studio',
  colors: { studio },
  fontFamily: 'Inter, system-ui, sans-serif',
  defaultRadius: 'sm',
  spacing: { xs: '8px', sm: '12px', md: '16px', lg: '24px', xl: '32px' },
  components: {
    Button: { defaultProps: { radius: 'sm' } },
    ActionIcon: { defaultProps: { radius: 'sm' } },
    Input: { defaultProps: { size: 'sm' } },
    Paper: { defaultProps: { radius: 'md', withBorder: true } },
  },
});

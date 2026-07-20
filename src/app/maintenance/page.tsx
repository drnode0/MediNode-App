import type { Metadata } from 'next'
import MaintenanceScreen from '@/components/MaintenanceScreen'

export const metadata: Metadata = {
  title: '調整中 | MediNode',
  robots: { index: false, follow: false },
}

export default function MaintenancePage() {
  return <MaintenanceScreen />
}

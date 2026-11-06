import type { Metadata } from 'next';
export const metadata:Metadata={title:'CrewCheck — Crew roster review demo',description:'Try a crew roster review workflow with fictional CSV and Excel data. Inspect evidence, revisit checks and explore versioned thresholds.',robots:{index:false,follow:false},icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>}

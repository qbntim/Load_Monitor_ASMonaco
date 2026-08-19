import "./globals.css";

export const metadata = {
  title: "AS Monaco – Load Monitor",
  description: "Training load monitoring for AS Monaco Volleyball",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

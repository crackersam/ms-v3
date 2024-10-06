import "./globals.css";

export const metadata = {
  title: "Gather",
  description: "An app by Sam Ames for gathering with friends",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="flex justify-center">{children}</body>
    </html>
  );
}

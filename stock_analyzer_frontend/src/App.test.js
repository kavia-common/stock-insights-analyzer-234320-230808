import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders Stock Check dashboard heading", () => {
  render(<App />);
  const heading = screen.getByRole("heading", { name: /run stock check/i });
  expect(heading).toBeInTheDocument();
});

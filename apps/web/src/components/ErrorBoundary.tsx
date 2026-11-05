import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** When this value changes, a caught error is cleared. */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
  key: unknown;
}

/** Keeps a broken board or preview from taking the whole page down. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.key) return { error: null, key: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Render error", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (error) {
      return this.props.fallback ? (
        this.props.fallback(error, this.reset)
      ) : (
        <div className="notice notice-error">
          <p>Не удалось нарисовать этот блок: {error.message}</p>
          <button type="button" className="btn btn-small" onClick={this.reset}>
            Попробовать ещё раз
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

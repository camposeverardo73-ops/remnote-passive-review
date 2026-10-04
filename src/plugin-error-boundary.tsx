import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { failed: boolean; retryToken: number };

/**
 * Production-safe boundary: user-facing UI never exposes stack traces, RN IDs,
 * raw window strings, or internal JSON. Technical details stay in the console.
 */
export class PluginErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, retryToken: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Mindmap][ERROR_BOUNDARY]', error, info.componentStack);
  }

  private retry = () => {
    this.setState((current) => ({ failed: false, retryToken: current.retryToken + 1 }));
  };

  render() {
    if (this.state.failed) {
      return (
        <main className="plugin-error-boundary" role="alert">
          <section>
            <strong>该功能暂时无法加载</strong>
            <span>你的笔记、遮挡和 RemNote 卡片没有被删除。</span>
            <button type="button" onClick={this.retry}>重新尝试</button>
          </section>
        </main>
      );
    }
    return <div key={this.state.retryToken} className="plugin-error-boundary-content">{this.props.children}</div>;
  }
}

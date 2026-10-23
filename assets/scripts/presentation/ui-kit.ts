import { Button, Color, Graphics, Label, Layers, Node, UITransform, UIOpacity } from 'cc';

export const PALETTE = {
  background: new Color(13, 33, 39), panel: new Color(23, 53, 61),
  button: new Color(44, 85, 95), accent: new Color(238, 183, 82),
  text: new Color(239, 243, 232), muted: new Color(167, 194, 191),
  card: new Color(248, 244, 229), ink: new Color(29, 49, 55), red: new Color(183, 53, 58),
};

export function uiNode(parent: Node, name: string, width: number, height: number, x = 0, y = 0): Node {
  const node = new Node(name);
  node.layer = Layers.Enum.UI_2D;
  node.addComponent(UITransform).setContentSize(width, height);
  parent.addChild(node);
  node.setPosition(x, y);
  return node;
}

export function paint(node: Node, color: Color, radius = 12): void {
  const transform = node.getComponent(UITransform);
  if (!transform) throw new Error('UITransform required');
  const graphics = node.getComponent(Graphics) || node.addComponent(Graphics);
  graphics.clear();
  graphics.fillColor = color;
  graphics.roundRect(-transform.width / 2, -transform.height / 2, transform.width, transform.height, radius);
  graphics.fill();
}

export function text(parent: Node, name: string, value: string, width: number, height: number,
  x: number, y: number, size = 24, color = PALETTE.text): Label {
  const node = uiNode(parent, name, width, height, x, y);
  const label = node.addComponent(Label);
  label.string = value;
  label.fontSize = size;
  label.lineHeight = size + 6;
  label.color = color;
  label.horizontalAlign = Label.HorizontalAlign.CENTER;
  label.verticalAlign = Label.VerticalAlign.CENTER;
  label.overflow = Label.Overflow.SHRINK;
  label.enableWrapText = true;
  label.useSystemFont = true;
  label.fontFamily = 'Arial';
  return label;
}

export class UiButton {
  public readonly node: Node;
  public readonly button: Button;
  public readonly label: Label;
  private readonly opacity: UIOpacity;

  public constructor(parent: Node, name: string, value: string, width: number, height: number,
    x: number, y: number, callback: () => void, accent = false) {
    this.node = uiNode(parent, name, width, height, x, y);
    paint(this.node, accent ? PALETTE.accent : PALETTE.button);
    this.button = this.node.addComponent(Button);
    this.button.transition = Button.Transition.NONE;
    this.opacity = this.node.addComponent(UIOpacity);
    this.label = text(this.node, 'Label', value, width - 12, height - 6, 0, 0, 23,
      accent ? PALETTE.ink : PALETTE.text);
    this.node.on(Button.EventType.CLICK, callback);
  }

  public setEnabled(enabled: boolean, dim = true): void {
    this.button.interactable = enabled;
    this.opacity.opacity = enabled || !dim ? 255 : 95;
  }
}

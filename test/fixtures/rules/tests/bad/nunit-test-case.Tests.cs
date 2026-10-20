[TestFixture]
public class SumTests
{
    [TestCase(1, 2)]
    [TestCase(2, 4)]
    public void Doubles(int value, int expected) => Assert.That(value * 2, Is.EqualTo(expected));
}
